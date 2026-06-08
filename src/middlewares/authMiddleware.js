// src/middlewares/authMiddleware.js
const crypto = require('crypto');
const prisma = require('../prisma');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';
const INVALID_SESSION_MESSAGE = "Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.";

function parseCookies(cookieHeader = '') {
    return cookieHeader.split(';').reduce((cookies, pair) => {
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex === -1) return cookies;

        const key = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);

        return cookies;
    }, {});
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = async (req, res, next) => {
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
                error: "Sua conta nao esta ativa para acessar este recurso."
            });
        }

        await prisma.session.update({
            where: { id: session.id },
            data: { lastUsedAt: new Date() }
        });

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
        console.error("Erro ao validar sessao:", error);
        return res.status(401).json({
            error: INVALID_SESSION_MESSAGE
        });
    }
};
