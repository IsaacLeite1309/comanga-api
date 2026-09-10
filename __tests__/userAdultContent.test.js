const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'adult-content-test.local';
const validPassword = 'SenhaForte123!';

function makeUser(overrides = {}) {
    const suffix = overrides.suffix || Math.random().toString(16).slice(2, 8);

    return {
        username: `adult_${runId}_${suffix}`.slice(0, 50),
        email: `adult_${runId}_${suffix}@${testEmailDomain}`,
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
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, birth_date, conteudo_adulto)
         VALUES ($1, $2, $3, $4, $5, '2000-01-01', $6)
         RETURNING id, username, email, conteudo_adulto`,
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
        .send({ email: user.email, password: validPassword });

    const cookies = response.headers['set-cookie'] || [];
    return cookies.find((cookie) => cookie.startsWith('comanga_session='));
}

async function findUserByEmail(email) {
    const result = await db.query(
        'SELECT id, conteudo_adulto FROM users WHERE email = $1',
        [email]
    );

    return result.rows[0];
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'adult_%']
    );
}

describe('PATCH /api/users/me/adult-content', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('atualiza a preferencia +18 apenas do usuario autenticado', async () => {
        const requester = makeUser({ suffix: 'requester', conteudoAdulto: false });
        const target = makeUser({ suffix: 'target', conteudoAdulto: false });
        await insertUser(requester);
        const targetResult = await insertUser(target);
        const sessionCookie = await loginUser(requester);

        const response = await request(app)
            .patch('/api/users/me/adult-content')
            .set('Cookie', sessionCookie)
            .send({
                id: String(targetResult.rows[0].id),
                conteudo_adulto: true
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            message: 'Preferência de exibição atualizada com sucesso!',
            conteudo_adulto: true
        });

        const requesterAfterUpdate = await findUserByEmail(requester.email);
        const targetAfterUpdate = await findUserByEmail(target.email);

        expect(requesterAfterUpdate.conteudo_adulto).toBe(true);
        expect(targetAfterUpdate.conteudo_adulto).toBe(false);
    });

    it('rejeita payload que nao envia booleano estrito', async () => {
        const user = makeUser();
        await insertUser(user);
        const sessionCookie = await loginUser(user);

        const response = await request(app)
            .patch('/api/users/me/adult-content')
            .set('Cookie', sessionCookie)
            .send({ conteudo_adulto: 'Ativada' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            error: "Formato inválido. A preferência 'conteudo_adulto' deve ser estritamente verdadeira (true) ou falsa (false)."
        });
    });

    it('bloqueia atualizacao sem sessao ativa', async () => {
        const response = await request(app)
            .patch('/api/users/me/adult-content')
            .send({ conteudo_adulto: true });

        expect(response.status).toBe(401);
    });
});
