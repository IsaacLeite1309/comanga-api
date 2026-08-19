import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../prisma';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    for (const pair of (cookieHeader || '').split(';')) {
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = pair.slice(0, separatorIndex).trim();
        if (key !== name) continue;

        try {
            return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
        } catch {
            return undefined;
        }
    }

    return undefined;
}

function hashSessionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function optionalSessionMiddleware(req: Request, _res: Response, next: NextFunction) {
    req.publicCatalogViewer = { canViewAdultContent: false };
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);

    if (!token) return next();

    try {
        const session = await prisma.session.findFirst({
            where: {
                sessionTokenHash: hashSessionToken(token),
                revokedAt: null
            },
            select: {
                user: {
                    select: {
                        id: true,
                        status: true,
                        conteudoAdulto: true
                    }
                }
            }
        });

        if (session?.user.status === 'Ativada') {
            req.publicCatalogViewer = {
                userId: session.user.id,
                canViewAdultContent: session.user.conteudoAdulto
            };
        }
    } catch {
        // A sessão é opcional nas rotas públicas. Falhas de validação reduzem o
        // acesso para visitante, mantendo privadas e conteúdo adulto ocultos.
    }

    return next();
}

export {
    readCookie,
    hashSessionToken
};

export default optionalSessionMiddleware;
