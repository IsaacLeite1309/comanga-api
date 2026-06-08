const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'profile-test.local';
const validPassword = 'SenhaForte123!';
const deniedMessage = 'Acesso negado: Você não tem permissão para acessar ou modificar os dados deste perfil.';

function makeUser(overrides = {}) {
    const suffix = overrides.suffix || Math.random().toString(16).slice(2, 8);

    return {
        username: `perfil_${runId}_${suffix}`.slice(0, 50),
        email: `perfil_${runId}_${suffix}@${testEmailDomain}`,
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

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'perfil_%']
    );
}

describe('GET /api/users/me', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('retorna apenas username, email e conteudo_adulto da sessao ativa', async () => {
        const user = makeUser({ conteudoAdulto: true });
        await insertUser(user);
        const sessionCookie = await loginUser(user);

        const response = await request(app)
            .get('/api/users/me')
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            user: {
                username: user.username,
                email: user.email,
                conteudo_adulto: true
            }
        });
        expect(Object.keys(response.body.user).sort()).toEqual([
            'conteudo_adulto',
            'email',
            'username'
        ]);
    });

    it('bloqueia consulta de perfil sem sessao ativa', async () => {
        const response = await request(app).get('/api/users/me');

        expect(response.status).toBe(401);
    });
});

describe('GET /api/users/:id IDOR', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('bloqueia usuario padrao tentando consultar perfil de outro usuario RN0022', async () => {
        const requester = makeUser({ suffix: 'requester' });
        const target = makeUser({ suffix: 'target' });
        await insertUser(requester);
        const targetResult = await insertUser(target);
        const sessionCookie = await loginUser(requester);

        const response = await request(app)
            .get(`/api/users/${targetResult.rows[0].id}`)
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: deniedMessage });
    });
});
