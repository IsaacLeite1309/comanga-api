const request = require('supertest');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'login-test.local';
const validPassword = 'SenhaForte123!';
const invalidSessionMessage = 'Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.';

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function makeUser(overrides = {}) {
    return {
        username: `login_${runId}`.slice(0, 50),
        email: `login_${runId}@${testEmailDomain}`,
        password: validPassword,
        status: 'Ativada',
        nivelAcesso: 'Usuário Padrão',
        ...overrides
    };
}

async function insertUser(user) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    return db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, email, status, nivel_acesso`,
        [user.username, user.email, passwordHash, user.status, user.nivelAcesso]
    );
}

function getSessionCookie(response) {
    const cookies = response.headers['set-cookie'] || [];
    return cookies.find((cookie) => cookie.startsWith('comanga_session='));
}

function getSessionToken(cookie) {
    return cookie.split(';')[0].replace('comanga_session=', '');
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'login_%']
    );
}

describe('POST /api/auth/login e middleware de sessao', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('autentica credenciais validas, cria sessao stateful e seta cookie HttpOnly', async () => {
        const user = makeUser();
        const insertedUser = (await insertUser(user)).rows[0];

        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: user.email, password: validPassword });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            message: 'Login realizado com sucesso!',
            user: {
                id: String(insertedUser.id),
                username: user.username,
                role: user.nivelAcesso
            }
        });

        const sessionCookie = getSessionCookie(response);
        expect(sessionCookie).toEqual(expect.stringContaining('HttpOnly'));
        expect(sessionCookie).toEqual(expect.stringContaining('SameSite=Strict'));

        const sessionToken = getSessionToken(sessionCookie);
        const sessionResult = await db.query(
            'SELECT user_id, session_token_hash, revoked_at FROM sessions WHERE session_token_hash = $1',
            [hashSessionToken(sessionToken)]
        );

        expect(sessionResult.rows).toHaveLength(1);
        expect(String(sessionResult.rows[0].user_id)).toBe(String(insertedUser.id));
        expect(sessionResult.rows[0].revoked_at).toBeNull();
    });

    it('rejeita e-mail inexistente com credenciais invalidas RN0012', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: `inexistente_${runId}@${testEmailDomain}`, password: validPassword });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Credenciais inválidas!' });
    });

    it('rejeita senha incorreta com credenciais invalidas RN0012', async () => {
        const user = makeUser();
        await insertUser(user);

        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: user.email, password: 'SenhaErrada123!' });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Credenciais inválidas!' });
    });

    it('bloqueia login de conta pendente RN0013', async () => {
        const user = makeUser({ status: 'Pendente' });
        await insertUser(user);

        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: user.email, password: validPassword });

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
            error: 'Conta de acesso pendente. Ative a conta com o e-mail de verificação enviado anteriormente.'
        });
    });

    it('bloqueia rota protegida sem cookie de sessao RN0014', async () => {
        const response = await request(app).get('/api/auth/me');

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: invalidSessionMessage });
    });

    it('permite rota protegida com sessao valida e bloqueia apos revogacao', async () => {
        const user = makeUser();
        await insertUser(user);

        const loginResponse = await request(app)
            .post('/api/auth/login')
            .send({ email: user.email, password: validPassword });

        const sessionCookie = getSessionCookie(loginResponse);

        const meResponse = await request(app)
            .get('/api/auth/me')
            .set('Cookie', sessionCookie);

        expect(meResponse.status).toBe(200);
        expect(meResponse.body.user.email).toBe(user.email);

        const sessionToken = getSessionToken(sessionCookie);
        await db.query(
            'UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_token_hash = $1',
            [hashSessionToken(sessionToken)]
        );

        const revokedResponse = await request(app)
            .get('/api/auth/me')
            .set('Cookie', sessionCookie);

        expect(revokedResponse.status).toBe(401);
        expect(revokedResponse.body).toEqual({ error: invalidSessionMessage });
    });
});
