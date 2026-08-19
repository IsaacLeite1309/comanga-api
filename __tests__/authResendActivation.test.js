const request = require('supertest');

jest.mock('../src/utils/mailer', () => ({
    sendActivationEmail: jest.fn()
}));

const db = require('../src/database');
const mailer = require('../src/utils/mailer');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'reenvio-test.local';

function makeUser(overrides = {}) {
    return {
        username: `resend_${runId}`.slice(0, 50),
        email: `resend_${runId}@${testEmailDomain}`,
        passwordHash: 'hash_de_teste',
        status: 'Pendente',
        activationToken: `token_antigo_${runId}`.slice(0, 64),
        activationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ...overrides
    };
}

async function insertUser(user) {
    return db.query(
        `INSERT INTO users (username, email, password_hash, status, activation_token, activation_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, email, status, activation_token, activation_expires_at`,
        [user.username, user.email, user.passwordHash, user.status, user.activationToken, user.activationExpiresAt]
    );
}

async function getUserByEmail(email) {
    const result = await db.query(
        `SELECT username, email, status, activation_token, activation_expires_at
         FROM users
         WHERE email = $1`,
        [email]
    );

    return result.rows[0];
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'resend_%']
    );
}

describe('POST /api/auth/resend-activation', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('sobrescreve token antigo, renova expiracao e envia e-mail para conta pendente', async () => {
        mailer.sendActivationEmail.mockResolvedValueOnce();
        const user = makeUser();
        await insertUser(user);

        const response = await request(app)
            .post('/api/auth/resend-activation')
            .send({ email: user.email });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            message: 'Novo link de ativação enviado com sucesso para o seu e-mail!'
        });

        const updatedUser = await getUserByEmail(user.email);
        expect(updatedUser.activation_token).toEqual(expect.any(String));
        expect(updatedUser.activation_token).toHaveLength(64);
        expect(updatedUser.activation_token).not.toBe(user.activationToken);
        expect(updatedUser.activation_expires_at).toBeInstanceOf(Date);
        expect(updatedUser.activation_expires_at.getTime()).toBeGreaterThan(user.activationExpiresAt.getTime());

        const oldTokenResult = await db.query(
            'SELECT id FROM users WHERE activation_token = $1',
            [user.activationToken]
        );
        expect(oldTokenResult.rows).toHaveLength(0);

        expect(mailer.sendActivationEmail).toHaveBeenCalledWith(
            user.email,
            user.username,
            updatedUser.activation_token
        );
    });

    it('faz token antigo deixar de ativar a conta apos sobrescrita RN0011', async () => {
        mailer.sendActivationEmail.mockResolvedValueOnce();
        const user = makeUser();
        await insertUser(user);

        await request(app)
            .post('/api/auth/resend-activation')
            .send({ email: user.email })
            .expect(200);

        const response = await request(app)
            .get(`/api/auth/activate/${user.activationToken}`);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Link de ativação inválido!'
        });
    });

    it('rejeita e-mail inexistente RN0009', async () => {
        const response = await request(app)
            .post('/api/auth/resend-activation')
            .send({ email: `inexistente_${runId}@${testEmailDomain}` });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
            error: 'Endereço de e-mail não cadastrado'
        });
        expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
    });

    it('rejeita reenvio para conta ja ativada RN0010', async () => {
        const user = makeUser({ status: 'Ativada' });
        await insertUser(user);

        const response = await request(app)
            .post('/api/auth/resend-activation')
            .send({ email: user.email });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Este endereço de e-mail pertence a uma conta ativada.'
        });
        expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
    });

    it('rejeita reenvio para conta bloqueada', async () => {
        const user = makeUser({ status: 'Bloqueada' });
        await insertUser(user);

        const response = await request(app)
            .post('/api/auth/resend-activation')
            .send({ email: user.email });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Somente contas pendentes podem solicitar um novo link de ativação.'
        });

        const unchangedUser = await getUserByEmail(user.email);
        expect(unchangedUser.activation_token).toBe(user.activationToken);
        expect(unchangedUser.activation_expires_at).toEqual(user.activationExpiresAt);
        expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
    });
});
