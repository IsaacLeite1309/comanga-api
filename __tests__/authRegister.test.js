const request = require('supertest');
const bcrypt = require('bcrypt');

jest.mock('../src/utils/mailer', () => ({
    sendActivationEmail: jest.fn()
}));

const db = require('../src/database');
const mailer = require('../src/utils/mailer');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'cadastro-test.local';

function makePayload(overrides = {}) {
    return {
        username: `novo_user_${runId}`.slice(0, 20),
        email: `novo_${runId}@${testEmailDomain}`,
        password: 'SenhaForte123!',
        confirmPassword: 'SenhaForte123!',
        ...overrides
    };
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'novo_user_%']
    );
}

describe('POST /api/auth/register', () => {
    beforeAll(async () => {
        await deleteTestUsers();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('cria usuario pendente, salva senha com bcrypt, gera token e dispara e-mail', async () => {
        mailer.sendActivationEmail.mockResolvedValueOnce();
        const payload = makePayload();

        const response = await request(app)
            .post('/api/auth/register')
            .send(payload);

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ message: 'Conta criada com sucesso! Enviamos o e-mail de ativacao.' });

        const userResult = await db.query(
            `SELECT username, email, password_hash, status, nivel_acesso,
                    conteudo_adulto, activation_token, activation_expires_at
             FROM users
             WHERE email = $1`,
            [payload.email]
        );

        expect(userResult.rows).toHaveLength(1);
        const user = userResult.rows[0];

        expect(user.username).toBe(payload.username);
        expect(user.email).toBe(payload.email);
        expect(user.password_hash).not.toBe(payload.password);
        await expect(bcrypt.compare(payload.password, user.password_hash)).resolves.toBe(true);
        expect(user.status).toBe('Pendente');
        expect(user.nivel_acesso).toBe('Usuário Padrão');
        expect(user.conteudo_adulto).toBe(false);
        expect(user.activation_token).toEqual(expect.any(String));
        expect(user.activation_token).toHaveLength(64);
        expect(user.activation_expires_at).toBeInstanceOf(Date);

        expect(mailer.sendActivationEmail).toHaveBeenCalledWith(
            payload.email,
            payload.username,
            user.activation_token
        );
    });

    it('rejeita nome de usuario fora do padrao RN0001 antes de inserir', async () => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(makePayload({ username: 'User Inválido!' }));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Utilize entre 3 e 20 caracteres, sem espaços, acentos ou caracteres especiais.',
            field: 'username'
        });

        const users = await db.query('SELECT id FROM users WHERE email LIKE $1', [`%@${testEmailDomain}`]);
        expect(users.rows).toHaveLength(0);
        expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
    });

    it('rejeita senha fraca RN0002 antes de inserir', async () => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(makePayload({
                password: 'fraca12',
                confirmPassword: 'fraca12'
            }));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Utilize no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial.',
            field: 'password'
        });
    });

    it('rejeita e-mail duplicado RN0003 com HTTP 409', async () => {
        const payload = makePayload();
        await db.query(
            `INSERT INTO users (username, email, password_hash, activation_token, activation_expires_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [payload.username, payload.email, 'hash_existente', 'token_existente', new Date(Date.now() + 3600000)]
        );

        const response = await request(app)
            .post('/api/auth/register')
            .send(makePayload({
                username: `outro_${runId}`.slice(0, 20),
                email: payload.email
            }));

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            error: 'Este endereço de e-mail já está em uso. Tente fazer login ou recuperar sua senha.',
            field: 'email'
        });
        expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
    });

    it('rejeita username duplicado RN0004 com HTTP 409', async () => {
        const payload = makePayload();
        await db.query(
            `INSERT INTO users (username, email, password_hash, activation_token, activation_expires_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [payload.username, payload.email, 'hash_existente', 'token_existente', new Date(Date.now() + 3600000)]
        );

        const response = await request(app)
            .post('/api/auth/register')
            .send(makePayload({
                username: payload.username,
                email: `outro_${runId}@${testEmailDomain}`
            }));

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            error: 'Este nome de usuário não está disponível. Por favor, escolha outro.',
            field: 'username'
        });
        expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
    });

    it('rejeita divergencia de confirmacao de senha RN0020 antes de inserir', async () => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(makePayload({ confirmPassword: 'SenhaDiferente123!' }));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: 'Divergência nos valores da senha e confirmação de senha!',
            field: 'confirmPassword'
        });
        expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
    });
});
