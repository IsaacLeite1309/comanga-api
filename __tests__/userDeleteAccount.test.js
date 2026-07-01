const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'delete-account-test.local';
const validPassword = 'SenhaForte123!';

function makeUser(overrides = {}) {
    const suffix = overrides.suffix || Math.random().toString(16).slice(2, 8);

    return {
        username: `delete_${runId}_${suffix}`.slice(0, 50),
        email: `delete_${runId}_${suffix}@${testEmailDomain}`,
        password: validPassword,
        status: 'Ativada',
        nivelAcesso: 'Usuário Padrão',
        conteudoAdulto: false,
        ...overrides
    };
}

async function insertUser(user) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    return db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, conteudo_adulto)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, email`,
        [
            user.username,
            user.email,
            passwordHash,
            user.status,
            user.nivelAcesso,
            user.conteudoAdulto
        ]
    );
}

async function loginUser(user) {
    const response = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password });

    const cookies = response.headers['set-cookie'] || [];
    return cookies.find((cookie) => cookie.startsWith('comanga_session='));
}

async function countUsersByEmail(email) {
    const result = await db.query('SELECT COUNT(*)::int AS total FROM users WHERE email = $1', [email]);
    return result.rows[0].total;
}

async function countSessionsByUserId(userId) {
    const result = await db.query('SELECT COUNT(*)::int AS total FROM sessions WHERE user_id = $1', [userId]);
    return result.rows[0].total;
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'delete_%']
    );
}

describe('DELETE /api/users/me', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('exclui fisicamente a conta autenticada e remove sessoes por cascade', async () => {
        const user = makeUser({ suffix: 'happy' });
        const insertResult = await insertUser(user);
        const userId = insertResult.rows[0].id;
        const sessionCookie = await loginUser(user);

        expect(await countSessionsByUserId(userId)).toBe(1);

        const response = await request(app)
            .delete('/api/users/me')
            .set('Cookie', sessionCookie)
            .send({ currentPassword: validPassword });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Conta excluida permanentemente.' });
        expect(response.headers['set-cookie'].join(';')).toContain('comanga_session=');
        expect(await countUsersByEmail(user.email)).toBe(0);
        expect(await countSessionsByUserId(userId)).toBe(0);
    });

    it('rejeita senha atual incorreta e preserva a conta', async () => {
        const user = makeUser({ suffix: 'wrong-password' });
        await insertUser(user);
        const sessionCookie = await loginUser(user);

        const response = await request(app)
            .delete('/api/users/me')
            .set('Cookie', sessionCookie)
            .send({ currentPassword: 'SenhaErrada123!' });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Senha atual incorreta!' });
        expect(await countUsersByEmail(user.email)).toBe(1);
    });

    it('bloqueia exclusao sem sessao ativa', async () => {
        const response = await request(app)
            .delete('/api/users/me')
            .send({ currentPassword: validPassword });

        expect(response.status).toBe(401);
    });
});
