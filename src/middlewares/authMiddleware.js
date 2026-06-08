// src/middlewares/authMiddleware.js
const crypto = require('crypto');
const db = require('../database');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';

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
            error: "Sua sessao e invalida ou foi encerrada. Por favor, faca login novamente."
        });
    }

    try {
        const tokenHash = hashSessionToken(token);
        const sessionResult = await db.query(
            `SELECT
                sessions.id AS session_id,
                sessions.user_id,
                users.username,
                users.email,
                users.nivel_acesso,
                users.status
             FROM sessions
             INNER JOIN users ON users.id = sessions.user_id
             WHERE sessions.session_token_hash = $1
               AND sessions.revoked_at IS NULL`,
            [tokenHash]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(401).json({
                error: "Sua sessao e invalida ou foi encerrada. Por favor, faca login novamente."
            });
        }

        const session = sessionResult.rows[0];

        if (session.status !== 'Ativada') {
            return res.status(403).json({
                error: "Sua conta nao esta ativa para acessar este recurso."
            });
        }

        await db.query(
            'UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
            [session.session_id]
        );

        req.user = {
            userId: String(session.user_id),
            username: session.username,
            email: session.email,
            role: session.nivel_acesso
        };
        req.session = {
            id: session.session_id,
            tokenHash
        };

        return next();
    } catch (error) {
        console.error("Erro ao validar sessao:", error);
        return res.status(401).json({
            error: "Sua sessao e invalida ou foi encerrada. Por favor, faca login novamente."
        });
    }
};
