const request = require('supertest');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'ativacao-test.local';

function makeUser(overrides = {}) {
    return {
        username: `activate_${runId}`.slice(0, 50),
        email: `activate_${runId}@${testEmailDomain}`,
        passwordHash: 'hash_de_teste',
        activationToken: `token_${runId}`.slice(0, 64),
        activationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ...overrides
    };
}

async function insertUser(user) {
    return db.query(
        `INSERT INTO users (username, email, password_hash, activation_token, activation_expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, email, status, activation_token, activation_expires_at`,
        [user.username, user.email, user.passwordHash, user.activationToken, user.activationExpiresAt]
    );
}

async function getUserByEmail(email) {
    const result = await db.query(
        `SELECT status, activation_token, activation_expires_at
         FROM users
         WHERE email = $1`,
        [email]
    );

    return result.rows[0];
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'activate_%']
    );
}

describe('GET /api/auth/activate/:token', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('ativa conta com token valido e invalida o token consumido', async () => {
        const user = makeUser();
        await insertUser(user);

        const response = await request(app)
            .get(`/api/auth/activate/${user.activationToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Conta ativada com sucesso!' });

        const activatedUser = await getUserByEmail(user.email);
        expect(activatedUser.status).toBe('Ativada');
        expect(activatedUser.activation_token).toBeNull();
        expect(activatedUser.activation_expires_at).toBeNull();
    });

    it('rejeita token expirado e preserva a conta pendente', async () => {
        const user = makeUser({
            activationExpiresAt: new Date(Date.now() - 60 * 1000)
        });
        await insertUser(user);

        const response = await request(app)
            .get(`/api/auth/activate/${user.activationToken}`);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Este link de ativação expirou. Solicite um novo e-mail de ativação.'
        });

        const pendingUser = await getUserByEmail(user.email);
        expect(pendingUser.status).toBe('Pendente');
        expect(pendingUser.activation_token).toBe(user.activationToken);
        expect(pendingUser.activation_expires_at).toBeInstanceOf(Date);
    });

    it('rejeita token inexistente ou invalido', async () => {
        const response = await request(app)
            .get('/api/auth/activate/token-inexistente');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Link de ativação inválido!'
        });
    });

    it('rejeita reuso de token ja consumido', async () => {
        const user = makeUser();
        await insertUser(user);

        const firstResponse = await request(app)
            .get(`/api/auth/activate/${user.activationToken}`);
        expect(firstResponse.status).toBe(200);

        const secondResponse = await request(app)
            .get(`/api/auth/activate/${user.activationToken}`);

        expect(secondResponse.status).toBe(400);
        expect(secondResponse.body).toEqual({
            error: 'Link de ativação inválido!'
        });
    });

    it('permite que apenas uma requisicao concorrente consuma o token', async () => {
        const user = makeUser();
        await insertUser(user);

        const responses = await Promise.all([
            request(app).get(`/api/auth/activate/${user.activationToken}`),
            request(app).get(`/api/auth/activate/${user.activationToken}`)
        ]);

        expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
        expect(responses.find(({ status }) => status === 400).body).toEqual({
            error: 'Link de ativação inválido!'
        });
    });
});
