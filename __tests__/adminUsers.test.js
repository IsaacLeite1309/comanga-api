const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'admin-users-test.local';
const validPassword = 'SenhaForte123!';

jest.setTimeout(30000);

function makeUser(overrides = {}) {
    const suffix = overrides.suffix || Math.random().toString(16).slice(2, 8);

    return {
        username: `admin_${runId}_${suffix}`.slice(0, 50),
        email: `admin_${runId}_${suffix}@${testEmailDomain}`,
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
         RETURNING id, username, email, status, nivel_acesso`,
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

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, `admin_${runId}_%`]
    );
}

describe('Rotas administrativas de usuarios', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    describe('GET /api/admin/users', () => {
        it('lista usuarios aplicando filtros combinados e ordenacao desc', async () => {
            const admin = makeUser({
                suffix: 'root',
                username: `admin_${runId}_root`.slice(0, 50),
                nivelAcesso: 'Administrador'
            });
            const zelda = makeUser({
                suffix: 'zelda',
                username: `admin_${runId}_zelda`.slice(0, 50),
                email: `zelda_${runId}@${testEmailDomain}`,
                nivelAcesso: 'Usuário Padrão',
                status: 'Ativada'
            });
            const ana = makeUser({
                suffix: 'ana',
                username: `admin_${runId}_ana`.slice(0, 50),
                email: `ana_${runId}@${testEmailDomain}`,
                nivelAcesso: 'Usuário Padrão',
                status: 'Ativada'
            });

            await insertUser(admin);
            await insertUser(zelda);
            await insertUser(ana);
            const sessionCookie = await loginUser(admin);

            const response = await request(app)
                .get('/api/admin/users')
                .query({
                    term: `_${runId}_`,
                    role: 'Usuário Padrão',
                    status: 'Ativada',
                    order: 'DESC',
                    limit: 10
                })
                .set('Cookie', sessionCookie);

            expect(response.status).toBe(200);
            expect(response.body.users).toHaveLength(2);
            expect(response.body.users.map((user) => user.username)).toEqual([
                zelda.username,
                ana.username
            ]);
            expect(response.body.users[0]).toEqual({
                id: expect.any(String),
                username: zelda.username,
                email: zelda.email,
                role: 'Usuário Padrão',
                status: 'Ativada'
            });
        });

        it('bloqueia Usuário Padrão tentando acessar a listagem administrativa', async () => {
            const regularUser = makeUser({ suffix: 'regular' });
            await insertUser(regularUser);
            const sessionCookie = await loginUser(regularUser);

            const response = await request(app)
                .get('/api/admin/users')
                .set('Cookie', sessionCookie);

            expect(response.status).toBe(403);
        });
    });

    describe('PATCH /api/admin/users/:id/role', () => {
        it('altera o nivel de acesso de outro usuario', async () => {
            const admin = makeUser({
                suffix: 'role-admin',
                nivelAcesso: 'Administrador'
            });
            const target = makeUser({ suffix: 'target' });

            await insertUser(admin);
            const targetResult = await insertUser(target);
            const targetId = targetResult.rows[0].id;
            const sessionCookie = await loginUser(admin);

            const response = await request(app)
                .patch(`/api/admin/users/${targetId}/role`)
                .set('Cookie', sessionCookie)
                .send({ role: 'Administrador' });

            expect(response.status).toBe(200);
            expect(response.body.user).toEqual({
                id: String(targetId),
                username: target.username,
                email: target.email,
                role: 'Administrador',
                status: 'Ativada'
            });

            const updatedUser = await db.query(
                'SELECT nivel_acesso FROM users WHERE id = $1',
                [targetId]
            );
            expect(updatedUser.rows[0].nivel_acesso).toBe('Administrador');
        });

        it('impede automodificacao do administrador autenticado', async () => {
            const admin = makeUser({
                suffix: 'self-role',
                nivelAcesso: 'Administrador'
            });
            const adminResult = await insertUser(admin);
            const adminId = adminResult.rows[0].id;
            const sessionCookie = await loginUser(admin);

            const response = await request(app)
                .patch(`/api/admin/users/${adminId}/role`)
                .set('Cookie', sessionCookie)
                .send({ role: 'Usuário Padrão' });

            expect(response.status).toBe(403);
            expect(response.body).toEqual({
                error: 'Você não pode alterar o nível de acesso de sua própria conta!'
            });
        });
    });
});

