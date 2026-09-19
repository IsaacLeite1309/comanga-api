import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../prisma';
import structuredLogger from '../infrastructure/logging/structuredLogger';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';
const INVALID_SESSION_MESSAGE = 'Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.';
const DEFAULT_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function readSessionTouchInterval(): number {
    const configured = Number(process.env.SESSION_TOUCH_INTERVAL_MS);
    return Number.isInteger(configured) && configured >= 0
        ? configured
        : DEFAULT_SESSION_TOUCH_INTERVAL_MS;
}

function parseCookies(cookieHeader = ''): Record<string, string> {
    return cookieHeader.split(';').reduce<Record<string, string>>((cookies, pair) => {
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex === -1) return cookies;

        const key = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);

        return cookies;
    }, {});
}

function hashSessionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];

    if (!token) {
        return res.status(401).json({
            error: INVALID_SESSION_MESSAGE
        });
    }

    try {
        const tokenHash = hashSessionToken(token);
        const session = await prisma.session.findFirst({
            where: {
                sessionTokenHash: tokenHash,
                revokedAt: null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        nivelAcesso: true,
                        status: true
                    }
                }
            }
        });

        if (!session) {
            return res.status(401).json({
                error: INVALID_SESSION_MESSAGE
            });
        }

        if (session.user.status !== 'Ativada') {
            return res.status(403).json({
                error: 'Sua conta nao esta ativa para acessar este recurso.'
            });
        }

        const now = new Date();
        const touchInterval = readSessionTouchInterval();
        const touchThreshold = new Date(now.getTime() - touchInterval);

        if (!session.lastUsedAt || session.lastUsedAt < touchThreshold) {
            await prisma.session.updateMany({
                where: {
                    id: session.id,
                    lastUsedAt: { lt: touchThreshold }
                },
                data: { lastUsedAt: now }
            });
        }

        req.user = {
            userId: String(session.user.id),
            username: session.user.username,
            email: session.user.email,
            role: session.user.nivelAcesso
        };
        req.session = {
            id: session.id,
            tokenHash
        };

        return next();
    } catch (error) {
        structuredLogger.error('auth.session.validation_failed', {
            requestId: req.requestId || 'not-provided'
        }, error);
        return res.status(401).json({
            error: INVALID_SESSION_MESSAGE
        });
    }
}

export = authMiddleware;
