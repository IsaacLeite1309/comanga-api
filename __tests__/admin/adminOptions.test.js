const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestCover } = require('../helpers/cover');

const db = require('../../src/database');
const app = require('../../src/app');

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
    await db.query('DELETE FROM works WHERE title LIKE $1', [`Sprint4 ${runId}%`]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`sprint4-${runId}/%`]);
    await db.query(
        'DELETE FROM domain_option_values WHERE label LIKE $1',
        [`Sprint4 ${runId}%`]
    );
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, `opt_${runId}_%`]
    );
}

async function getCategoryId(slug = 'tipos-capa') {
    const result = await db.query(
        'SELECT id FROM domain_option_categories WHERE slug = $1',
        [slug]
    );

    return result.rows[0].id;
}

async function insertOption(label, categorySlug = 'tipos-capa') {
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
            .send({ category: 'tipos-capa', label: `Sprint4 ${runId} Zeta` })
            .expect(201);

        await request(app)
            .post('/api/admin/options')
            .set('Cookie', sessionCookie)
            .send({ category: 'tipos-capa', label: `Sprint4 ${runId} Alpha` })
            .expect(201);

        const response = await request(app)
            .get('/api/admin/options/tipos-capa')
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

    it('não oferece país de origem nas opções administrativas', async () => {
 const admin=makeUser({suffix:'retired-country'});await insertUser(admin);const cookie=await loginUser(admin);
 const response=await request(app).get('/api/admin/options/paises-origem').set('Cookie',cookie);expect(response.status).toBe(404);
 const created=await request(app).post('/api/admin/options').set('Cookie',cookie).send({category:'paises-origem',label:'Brasil'});expect(created.status).toBe(404);
});

    it('bloqueia duplicidade de valor dentro da mesma categoria', async () => {
        const admin = makeUser({ suffix: 'duplicate' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);
        await insertOption(`Sprint4 ${runId} Duplicado`);

        const response = await request(app)
            .post('/api/admin/options')
            .set('Cookie', sessionCookie)
            .send({ category: 'tipos-capa', label: `Sprint4 ${runId} Duplicado` });

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

async function findOptionByCode(categorySlug, code) {
    const result = await db.query(
        `SELECT value.id, value.label, value.code, value.position, value.active, value.system_managed
         FROM domain_option_values value
         JOIN domain_option_categories category ON category.id = value.category_id
         WHERE category.slug = $1 AND value.code = $2`,
        [categorySlug, code]
    );

    return result.rows[0];
}

describe('valores de dom\u00ednio controlados pelo sistema', () => {
    beforeEach(deleteTestData);
    afterEach(deleteTestData);

    it('expoe identidade estavel, controle do sistema e a ordem oficial dos generos', async () => {
        const admin = makeUser({ suffix: 'controlled-list' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);

        const response = await request(app)
            .get('/api/admin/options/generos')
            .query({ order: 'ASC', page: 1, limit: 100 })
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(200);
        const officialGenres = response.body.values.filter((value) => value.systemManaged);
        expect(officialGenres).toHaveLength(21);
        expect(officialGenres.slice(0, 4).map((value) => value.label)).toEqual([
            'Aventura', 'A\u00e7\u00e3o', 'Boys\u2019 Love', 'Com\u00e9dia'
        ]);
        expect(officialGenres.map((value) => value.position)).toEqual(
            officialGenres.map((_value, index) => index)
        );
        expect(officialGenres.find((value) => value.code === 'hentai')).toEqual(
            expect.objectContaining({ label: 'Hentai', systemManaged: true, active: true })
        );
    });

    it('entrega os tipos de Obra oficiais com as dependencias de pais completas', async () => {
        const admin = makeUser({ suffix: 'controlled-types' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);

        const response = await request(app)
            .get('/api/admin/options/tipos-obra')
            .query({ order: 'ASC', page: 1, limit: 100 })
            .set('Cookie', sessionCookie);

        expect(response.status).toBe(200);
        const byCode = Object.fromEntries(response.body.values.map((value) => [value.code, value]));
        expect(Object.keys(byCode).sort()).toEqual([
            'artbook', 'databook', 'light-novel', 'manga', 'novel'
        ]);
        expect(response.body.values.every(value => !Object.hasOwn(value, 'depends_on'))).toBe(true);
        expect(response.body.values.every((value) => value.systemManaged)).toBe(true);
    });

    it.each(['generos', 'tipos-obra'])('recusa criar valor na categoria controlada %s', async (categorySlug) => {
        const admin = makeUser({ suffix: `no-create-${categorySlug}` });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);

        const response = await request(app)
            .post('/api/admin/options')
            .set('Cookie', sessionCookie)
            .send({ category: categorySlug, label: `Sprint4 ${runId} Novo` });

        expect(response.status).toBe(403);
        expect(response.body.error).toBe(
            'Os valores dessa lista s\u00e3o controlados pelo sistema e n\u00e3o podem ser criados.'
        );
        const created = await db.query(
            'SELECT id FROM domain_option_values WHERE label = $1',
            [`Sprint4 ${runId} Novo`]
        );
        expect(created.rows).toHaveLength(0);
    });

    it('recusa renomear, trocar dependencias e excluir valor controlado', async () => {
        const admin = makeUser({ suffix: 'no-rename' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);
        const hentai = await findOptionByCode('generos', 'hentai');
        const manga = await findOptionByCode('tipos-obra', 'manga');

        const renameResponse = await request(app)
            .patch(`/api/admin/options/${hentai.id}`)
            .set('Cookie', sessionCookie)
            .send({ label: `Sprint4 ${runId} Renomeado` });
        const dependencyResponse = await request(app)
            .patch(`/api/admin/options/${manga.id}`)
            .set('Cookie', sessionCookie)
            .send({ dependsOnValueIds: [manga.id] });
        const deleteResponse = await request(app)
            .delete(`/api/admin/options/${hentai.id}`)
            .set('Cookie', sessionCookie);

        expect(renameResponse.status).toBe(403);
        expect(dependencyResponse.status).toBe(400);
        expect(deleteResponse.status).toBe(403);
        expect(deleteResponse.body.error).toBe(
            'Esse valor \u00e9 controlado pelo sistema e n\u00e3o pode ser exclu\u00eddo.'
        );
        const stillThere = await findOptionByCode('generos', 'hentai');
        expect(stillThere).toEqual(expect.objectContaining({ label: 'Hentai', active: true }));
        expect((await db.query("SELECT to_regclass('domain_option_value_dependencies') AS dependencies")).rows).toEqual([{ dependencies: null }]);
    });

    it('permite desativar e reativar valor controlado sem remover associacoes', async () => {
        const admin = makeUser({ suffix: 'toggle-active' });
        await insertUser(admin);
        const sessionCookie = await loginUser(admin);
        const hentai = await findOptionByCode('generos', 'hentai');
        const manga = await findOptionByCode('tipos-obra', 'manga');
        const coverAssetId = await createTestCover(db, `sprint4-${runId}`);
        const work = await db.query(
            `INSERT INTO works (cover_asset_id, slug, title, romanized_title, synopsis, type_id,
                original_publication_status, visibility, adult_content, atualizado_em) VALUES ($1, $2, $3::text, $3::text, $3::text, $4, 'Completa', 'Privado', TRUE, NOW())
             RETURNING id`,
            [coverAssetId, `sprint4-${runId}-controlada`, `Sprint4 ${runId} Controlada`, manga.id]
        );
        await db.query(
            'INSERT INTO work_genres (work_id, genre_id) VALUES ($1, $2)',
            [work.rows[0].id, hentai.id]
        );

        const deactivate = await request(app)
            .patch(`/api/admin/options/${hentai.id}`)
            .set('Cookie', sessionCookie)
            .send({ active: false });

        expect(deactivate.status).toBe(200);
        expect(deactivate.body.value).toEqual(expect.objectContaining({
            code: 'hentai', active: false, systemManaged: true
        }));
        const association = await db.query(
            'SELECT genre_id FROM work_genres WHERE work_id = $1',
            [work.rows[0].id]
        );
        expect(association.rows).toHaveLength(1);

        const hiddenList = await request(app)
            .get('/api/admin/options/generos')
            .query({ order: 'ASC', page: 1, limit: 100 })
            .set('Cookie', sessionCookie);
        expect(hiddenList.body.values.some((value) => value.code === 'hentai')).toBe(false);

        const fullList = await request(app)
            .get('/api/admin/options/generos')
            .query({ order: 'ASC', page: 1, limit: 100, includeInactive: 'true' })
            .set('Cookie', sessionCookie);
        expect(fullList.body.values.some((value) => value.code === 'hentai')).toBe(true);

        const reactivate = await request(app)
            .patch(`/api/admin/options/${hentai.id}`)
            .set('Cookie', sessionCookie)
            .send({ active: true });
        expect(reactivate.status).toBe(200);
        expect(reactivate.body.value.active).toBe(true);
    });
});
