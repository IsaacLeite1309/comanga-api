const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'admin-options-test.local';
const validPassword = 'SenhaForte123!';

jest.setTimeout(30000);

function makeUser(overrides = {}) {
    const suffix = overrides.suffix || Math.random().toString(16).slice(2, 8);

    return {
        username: `opt_${runId}_${suffix}`.slice(0, 50),
        email: `opt_${runId}_${suffix}@${testEmailDomain}`,
        password: validPassword,
        status: 'Ativada',
        nivelAcesso: 'Administrador',
        conteudoAdulto: false,
        ...overrides
    };
}

async function insertUser(user) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    return db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, conteudo_adulto)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
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

async function deleteTestData() {
    await db.query(
        'DELETE FROM domain_option_values WHERE label LIKE $1',
        [`Sprint4 ${runId}%`]
    );
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, `opt_${runId}_%`]
    );
}

async function getCategoryId(slug = 'generos') {
    const result = await db.query(
        'SELECT id FROM domain_option_categories WHERE slug = $1',
        [slug]
    );

    return result.rows[0].id;
}

async function insertOption(label, categorySlug = 'generos') {
    const categoryId = await getCategoryId(categorySlug);

    return db.query(
        'INSERT INTO domain_option_values (category_id, label) VALUES ($1, $2) RETURNING id, label',
        [categoryId, label]
    );
}

describe('Rotas administrativas de opcoes', () => {
    beforeEach(async () => {
        await deleteTestData();
    });

    afterEach(async () => {
        await deleteTestData();
    });

    it('cadastra e lista valores de uma categoria em ordem alfabetica', async () => {
        const admin = makeUser({ suffix: 'create-list' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);

        await request(app)
            .post('/api/admin/options')
            .set('Cookie', sessionCookie)
            .send({ category: 'generos', label: `Sprint4 ${runId} Zeta` })
            .expect(201);

        await request(app)
            .post('/api/admin/options')
            .set('Cookie', sessionCookie)
            .send({ category: 'generos', label: `Sprint4 ${runId} Alpha` })
            .expect(201);

        const response = await request(app)
            .get('/api/admin/options/generos')
            .query({ term: `Sprint4 ${runId}`, order: 'ASC', page: 1, limit: 10 })
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(200);
        const values = response.body.values
            .filter((value) => value.label.startsWith(`Sprint4 ${runId}`))
            .map((value) => value.label);

        expect(values).toEqual([
            `Sprint4 ${runId} Alpha`,
            `Sprint4 ${runId} Zeta`
        ]);
    });

    it('lista paises de origem como referencia sem permitir seu cadastro', async () => {
        const admin = makeUser({ suffix: 'country-reference' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);
        const countryLabel = `Sprint4 ${runId} País`;
        await insertOption(countryLabel, 'paises-origem');

        const listResponse = await request(app)
            .get('/api/admin/options/paises-origem')
            .query({ order: 'ASC', page: 1, limit: 100 })
            .set('Cookie', sessionCookie);

        expect(listResponse.status).toBe(200);
        expect(listResponse.body.category).toEqual(expect.objectContaining({
            slug: 'paises-origem',
            name: expect.any(String)
        }));
        expect(listResponse.body.values.map((value) => value.label)).toEqual(
            expect.arrayContaining([countryLabel])
        );

        const createResponse = await request(app)
            .post('/api/admin/options')
            .set('Cookie', sessionCookie)
            .send({ category: 'paises-origem', label: 'Brasil' });

        expect(createResponse.status).toBe(404);
        expect(createResponse.body).toEqual({ error: 'Categoria não encontrada.' });
    });

    it('bloqueia duplicidade de valor dentro da mesma categoria', async () => {
        const admin = makeUser({ suffix: 'duplicate' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);
        await insertOption(`Sprint4 ${runId} Duplicado`);

        const response = await request(app)
            .post('/api/admin/options')
            .set('Cookie', sessionCookie)
            .send({ category: 'generos', label: `Sprint4 ${runId} Duplicado` });

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            error: `Essa lista já tem esse valor cadastrado: Sprint4 ${runId} Duplicado.`
        });
    });

    it('altera e exclui valor sem vinculos', async () => {
        const admin = makeUser({ suffix: 'update-delete' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);
        const insertResult = await insertOption(`Sprint4 ${runId} Antigo`);
        const optionId = insertResult.rows[0].id;

        const updateResponse = await request(app)
            .patch(`/api/admin/options/${optionId}`)
            .set('Cookie', sessionCookie)
            .send({ label: `Sprint4 ${runId} Novo` });

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body.value.label).toBe(`Sprint4 ${runId} Novo`);

        const deleteResponse = await request(app)
            .delete(`/api/admin/options/${optionId}`)
            .set('Cookie', sessionCookie);

        expect(deleteResponse.status).toBe(200);
        expect(deleteResponse.body).toEqual({ message: 'Valor excluído com sucesso.' });
    });

    it('bloqueia usuario padrao nas rotas de opcoes', async () => {
        const regularUser = makeUser({
            suffix: 'regular',
            nivelAcesso: 'Usuário Padrão'
        });
        await insertUser(regularUser);
        const sessionCookie = await loginUser(regularUser);

        const response = await request(app)
            .get('/api/admin/options/generos')
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(403);
    });
});
