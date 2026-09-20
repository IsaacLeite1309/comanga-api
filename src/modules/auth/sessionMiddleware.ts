import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import structuredLogger from '../../infrastructure/logging/structuredLogger';
import { isAdult } from './accountRules';
import { ADMIN_PROFILE_CODE, ADMIN_PROFILE_NAME, resolveActiveProfileName, sortProfileNames } from './profiles';
import { hashSessionToken, readSessionToken } from './session';

const INVALID_SESSION_MESSAGE = 'Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.';
const DEFAULT_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

interface AssignedProfileRow { profile: { code: string; name: string } }

function readSessionTouchInterval(): number {
    const configured = Number(process.env.SESSION_TOUCH_INTERVAL_MS);
    return Number.isInteger(configured) && configured >= 0 ? configured : DEFAULT_SESSION_TOUCH_INTERVAL_MS;
}

function readAssignedProfileNames(userProfiles: AssignedProfileRow[] | undefined): string[] {
    return sortProfileNames((userProfiles || []).map(assignment => assignment.profile.name));
}

function hasAdminProfile(userProfiles: AssignedProfileRow[] | undefined): boolean {
    return (userProfiles || []).some(assignment => assignment.profile.code === ADMIN_PROFILE_CODE);
}

async function touchSession(sessionId: number, lastUsedAt: Date | null | undefined): Promise<void> {
    const now = new Date();
    const touchThreshold = new Date(now.getTime() - readSessionTouchInterval());
    if (lastUsedAt && lastUsedAt >= touchThreshold) return;
    await prisma.session.updateMany({
        where: { id: sessionId, lastUsedAt: { lt: touchThreshold } },
        data: { lastUsedAt: now }
    });
}

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const token = readSessionToken(req);
    if (!token) return res.status(401).json({ error: INVALID_SESSION_MESSAGE });
    try {
        const tokenHash = hashSessionToken(token);
        const session = await prisma.session.findFirst({
            where: { sessionTokenHash: tokenHash, revokedAt: null },
            include: {
                activeProfile: { select: { code: true, name: true } },
                user: {
                    select: {
                        id: true, username: true, email: true, nivelAcesso: true, status: true,
                        userProfiles: { select: { profile: { select: { code: true, name: true } } } }
                    }
                }
            }
        });
        if (!session) return res.status(401).json({ error: INVALID_SESSION_MESSAGE });
        if (session.user.status !== 'Ativada') {
            return res.status(403).json({ error: 'Sua conta nao esta ativa para acessar este recurso.' });
        }

        await touchSession(session.id, session.lastUsedAt);
        const profiles = readAssignedProfileNames(session.user.userProfiles);
        const activeProfile = resolveActiveProfileName(profiles, session.activeProfile?.name);
        req.user = {
            userId: String(session.user.id),
            username: session.user.username,
            email: session.user.email,
            role: activeProfile,
            profiles,
            activeProfile,
            hasAdminAssignment: profiles.includes(ADMIN_PROFILE_NAME)
        };
        req.session = { id: session.id, tokenHash };
        return next();
    } catch (error) {
        structuredLogger.error('auth.session.validation_failed', {
            requestId: req.requestId || 'not-provided'
        }, error);
        return res.status(401).json({ error: INVALID_SESSION_MESSAGE });
    }
}

async function optionalSessionMiddleware(req: Request, _res: Response, next: NextFunction) {
    req.publicCatalogViewer = { canViewAdultContent: false, hasAdminAssignment: false };
    const token = readSessionToken(req);
    if (!token) return next();
    try {
        const session = await prisma.session.findFirst({
            where: { sessionTokenHash: hashSessionToken(token), revokedAt: null },
            select: {
                user: {
                    select: {
                        id: true, status: true, conteudoAdulto: true, birthDate: true,
                        userProfiles: { select: { profile: { select: { code: true, name: true } } } }
                    }
                }
            }
        });
        if (session?.user.status === 'Ativada') {
            req.publicCatalogViewer = {
                userId: session.user.id,
                canViewAdultContent: session.user.conteudoAdulto && isAdult(session.user.birthDate),
                // Atribuição vigente, independentemente do perfil ativo na sessão.
                hasAdminAssignment: hasAdminProfile(session.user.userProfiles)
            };
        }
    } catch {
        // Sessão opcional inválida ou indisponível mantém o visitante no menor nível de acesso.
    }
    return next();
}

export { authMiddleware, optionalSessionMiddleware };
