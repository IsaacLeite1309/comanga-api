const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'profile-test.local';
const validPassword = 'SenhaForte123!';

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
                can_enable_adult_content: true,
                conteudo_adulto: true,
                profiles: ['Usuário Padrão'],
                active_profile: 'Usuário Padrão'
            }
        });
        expect(Object.keys(response.body.user).sort()).toEqual([
            'active_profile',
            'can_enable_adult_content',
            'conteudo_adulto',
            'email',
            'profiles',
            'username'
        ]);
    });

    it('bloqueia consulta de perfil sem sessao ativa', async () => {
        const response = await request(app).get('/api/users/me');

        expect(response.status).toBe(401);
    });
});
