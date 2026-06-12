const request = require('supertest');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'logout-test.local';
const validPassword = 'SenhaForte123!';
const invalidSessionMessage = 'Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.';

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function makeUser() {
    return {
        username: `logout_${runId}`.slice(0, 50),
        email: `logout_${runId}@${testEmailDomain}`,
        password: validPassword
    };
}

async function insertUser(user) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    return db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso)
         VALUES ($1, $2, $3, 'Ativada', 'Usuário Padrão')
         RETURNING id`,
        [user.username, user.email, passwordHash]
    );
}

function getSessionCookie(response) {
    const cookies = response.headers['set-cookie'] || [];
    return cookies.find((cookie) => cookie.startsWith('comanga_session='));
}

function getSessionToken(cookie) {
    return cookie.split(';')[0].replace('comanga_session=', '');
}

async function loginUser(user) {
    const response = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: validPassword });

    return getSessionCookie(response);
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'logout_%']
    );
}

describe('POST /api/auth/logout', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('encerra a sessao ativa, revoga o registro no banco e limpa o cookie HttpOnly', async () => {
        const user = makeUser();
        await insertUser(user);

        const sessionCookie = await loginUser(user);
        const sessionToken = getSessionToken(sessionCookie);
        const tokenHash = hashSessionToken(sessionToken);

        const response = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Sessão encerrada com sucesso.' });

        const clearedCookie = getSessionCookie(response);
        expect(clearedCookie).toEqual(expect.stringContaining('comanga_session=;'));
        expect(clearedCookie).toEqual(expect.stringContaining('HttpOnly'));

        const sessionResult = await db.query(
            'SELECT revoked_at FROM sessions WHERE session_token_hash = $1',
            [tokenHash]
        );

        expect(sessionResult.rows).toHaveLength(1);
        expect(sessionResult.rows[0].revoked_at).toBeTruthy();
    });

    it('bloqueia o uso do cookie antigo apos logout RN0014', async () => {
        const user = makeUser();
        await insertUser(user);

        const sessionCookie = await loginUser(user);

        await request(app)
            .post('/api/auth/logout')
            .set('Cookie', sessionCookie);

        const response = await request(app)
            .get('/api/auth/me')
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: invalidSessionMessage });
    });

    it('rejeita logout sem sessao ativa', async () => {
        const response = await request(app).post('/api/auth/logout');

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: invalidSessionMessage });
    });
});
