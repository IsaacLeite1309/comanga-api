process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const request = require('supertest');
const bcrypt = require('bcrypt');

const { createTestCover } = require('./helpers/cover');
const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const fixturePrefix = `work_class_${runId}`;
const testEmailDomain = 'work-classifications-test.local';
const validPassword = 'SenhaForte123!';

jest.setTimeout(30000);

const fixture = { optionIds: [], workIds: [] };

async function insertAdmin() {
    const passwordHash = await bcrypt.hash(validPassword, 10);
    const email = `${fixturePrefix}_admin@${testEmailDomain}`;
    await db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, conteudo_adulto)
         VALUES ($1, $2, $3, 'Ativada', 'Administrador', TRUE)`,
        [`wc_${runId}`.slice(0, 20), email, passwordHash]
    );

    const response = await request(app)
        .post('/api/auth/login')
        .send({ email, password: validPassword });
    const cookies = response.headers['set-cookie'] || [];
    return cookies.find((cookie) => cookie.startsWith('comanga_session='));
}

async function findOfficialOption(categorySlug, code) {
    const result = await db.query(
        `SELECT value.id, value.label
         FROM domain_option_values value
         JOIN domain_option_categories category ON category.id = value.category_id
         WHERE category.slug = $1 AND value.code = $2`,
        [categorySlug, code]
    );

    return result.rows[0];
}

async function createFreeOption(categorySlug, suffix) {
    const category = await db.query(
        'SELECT id FROM domain_option_categories WHERE slug = $1',
        [categorySlug]
    );
    const result = await db.query(
        'INSERT INTO domain_option_values (category_id, label) VALUES ($1, $2) RETURNING id, label',
        [category.rows[0].id, `${fixturePrefix}_${suffix}`]
    );

    fixture.optionIds.push(result.rows[0].id);
    return result.rows[0];
}

async function deleteFixtures() {
    await db.query('DELETE FROM works WHERE title LIKE $1', [`${fixturePrefix}%`]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${fixturePrefix}/%`]);
    await db.query('DELETE FROM users WHERE email LIKE $1', [`%@${testEmailDomain}`]);

    if (fixture.optionIds.length > 0) {
        await db.query('DELETE FROM domain_option_values WHERE id = ANY($1::int[])', [fixture.optionIds]);
        fixture.optionIds.length = 0;
    }
}

function buildWorkPayload(overrides = {}) {
    return {
        title: `${fixturePrefix}_${overrides.suffix || 'obra'}`,
        romanizedTitle: `${fixturePrefix}_${overrides.suffix || 'obra'}`,
        synopsis: 'Sinopse da Obra de teste.',
        typeId: fixture.mangaType.id,
        country: 'Japão',
        originalPublicationStatus: 'Completa',
        coverAssetId: overrides.coverAssetId,
        authors: [{ authorId: fixture.author.id, roles: ['História e Arte'] }],
        genreIds: overrides.genreIds || [],
        adultContent: overrides.adultContent === undefined ? false : overrides.adultContent,
        ...(overrides.typeId ? { typeId: overrides.typeId } : {}),
        ...(overrides.country ? { country: overrides.country } : {})
    };
}

async function createWorkThroughApi(sessionCookie, overrides = {}) {
    const coverAssetId = await createTestCover(db, fixturePrefix);
    const payload = buildWorkPayload({ ...overrides, coverAssetId });
    const response = await request(app)
        .post('/api/admin/works')
        .set('Cookie', sessionCookie)
        .send(payload);

    if (response.status === 201) fixture.workIds.push(response.body.work.id);
    return response;
}

async function readAdultContent(workId) {
    const result = await db.query('SELECT adult_content FROM works WHERE id = $1', [workId]);
    return result.rows[0].adult_content;
}

describe('classificações controladas na área administrativa de Obras', () => {
    let sessionCookie;

    beforeAll(async () => {
        await deleteFixtures();
        fixture.mangaType = await findOfficialOption('tipos-obra', 'manga');
        fixture.manhwaType = await findOfficialOption('tipos-obra', 'manhwa');
        fixture.hentai = await findOfficialOption('generos', 'hentai');
        fixture.drama = await findOfficialOption('generos', 'drama');
        fixture.author = await createFreeOption('autores', 'autor');
        fixture.legacyType = await createFreeOption('tipos-obra', 'tipo-legado');
        sessionCookie = await insertAdmin();
    });

    afterAll(deleteFixtures);

    it.each(Object.entries({
        manga: ['Japão'], manhwa: ['Coreia do Sul'], manhua: ['China', 'Taiwan'],
        'light-novel': ['Japão'], novel: ['China', 'Coreia do Sul', 'Japão', 'Taiwan'],
        artbook: ['Japão'], databook: ['Japão']
    }).flatMap(([code, allowed]) => ['Japão', 'Coreia do Sul', 'China', 'Taiwan']
        .map(country => [code, country, allowed.includes(country)])))
    ('valida tipo %s no país %s na criação e atualização', async (code, country, allowed) => {
        const type = await findOfficialOption('tipos-obra', code);
        const result = await createWorkThroughApi(sessionCookie, {
            suffix: `matrix-create-${code}-${country}`, typeId: type.id, country
        });
        expect(result.status).toBe(allowed ? 201 : 400);
        const existing = await createWorkThroughApi(sessionCookie, { suffix: `matrix-update-${code}-${country}` });
        expect(existing.status).toBe(201);
        const updated = await request(app).patch(`/api/admin/works/${existing.body.work.id}`)
            .set('Cookie', sessionCookie).send({ typeId: type.id, country });
        expect(updated.status).toBe(allowed ? 200 : 400);
        if (!allowed) {
            const stored = await db.query('SELECT type_id, country FROM works WHERE id = $1', [existing.body.work.id]);
            expect(stored.rows[0]).toEqual({ type_id: fixture.mangaType.id, country: 'Japão' });
        }
    });

    it('força adultContent ao criar Obra com Hentai, mesmo recebendo false', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'hentai-criada',
            genreIds: [fixture.hentai.id],
            adultContent: false
        });

        expect(response.status).toBe(201);
        expect(response.body.work.adultContent).toBe(true);
        await expect(readAdultContent(response.body.work.id)).resolves.toBe(true);
    });

    it('mantém a Obra não adulta quando nenhum gênero restrito é escolhido', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'sem-hentai',
            genreIds: [fixture.drama.id],
            adultContent: false
        });

        expect(response.status).toBe(201);
        expect(response.body.work.adultContent).toBe(false);
    });

    it('recusa tipo de Obra incompatível com o país de origem', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'tipo-incompativel',
            typeId: fixture.manhwaType.id,
            country: 'Japão'
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Um ou mais valores selecionados são inválidos.');
    });

    it('recusa tipo de Obra sem dependência de país declarada', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'tipo-sem-dependencia',
            typeId: fixture.legacyType.id,
            country: 'Japão'
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Um ou mais valores selecionados são inválidos.');
    });

    it('aceita tipo oficial no país declarado pela dependência', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'manhwa-coreia',
            typeId: fixture.manhwaType.id,
            country: 'Coreia do Sul'
        });

        expect(response.status).toBe(201);
    });

    it('força adultContent ao adicionar Hentai em Obra existente', async () => {
        const created = await createWorkThroughApi(sessionCookie, {
            suffix: 'edicao-adiciona-hentai',
            genreIds: [fixture.drama.id],
            adultContent: false
        });

        const response = await request(app)
            .patch(`/api/admin/works/${created.body.work.id}`)
            .set('Cookie', sessionCookie)
            .send({ genreIds: [fixture.drama.id, fixture.hentai.id], adultContent: false });

        expect(response.status).toBe(200);
        expect(response.body.work.adultContent).toBe(true);
        await expect(readAdultContent(created.body.work.id)).resolves.toBe(true);
    });

    it('normaliza a tentativa de desativar adultContent com Hentai associado', async () => {
        const created = await createWorkThroughApi(sessionCookie, {
            suffix: 'edicao-mantem-hentai',
            genreIds: [fixture.hentai.id],
            adultContent: true
        });

        const response = await request(app)
            .patch(`/api/admin/works/${created.body.work.id}`)
            .set('Cookie', sessionCookie)
            .send({ adultContent: false });

        expect(response.status).toBe(200);
        expect(response.body.work.adultContent).toBe(true);
        await expect(readAdultContent(created.body.work.id)).resolves.toBe(true);
    });

    it('não desativa adultContent ao remover o gênero Hentai', async () => {
        const created = await createWorkThroughApi(sessionCookie, {
            suffix: 'edicao-remove-hentai',
            genreIds: [fixture.hentai.id],
            adultContent: true
        });

        const response = await request(app)
            .patch(`/api/admin/works/${created.body.work.id}`)
            .set('Cookie', sessionCookie)
            .send({ genreIds: [fixture.drama.id] });

        expect(response.status).toBe(200);
        expect(response.body.work.adultContent).toBe(true);
        await expect(readAdultContent(created.body.work.id)).resolves.toBe(true);
    });

    it('permite desativar adultContent depois que o Hentai deixa de estar associado', async () => {
        const created = await createWorkThroughApi(sessionCookie, {
            suffix: 'edicao-libera-adulto',
            genreIds: [fixture.hentai.id],
            adultContent: true
        });

        const response = await request(app)
            .patch(`/api/admin/works/${created.body.work.id}`)
            .set('Cookie', sessionCookie)
            .send({ genreIds: [fixture.drama.id], adultContent: false });

        expect(response.status).toBe(200);
        expect(response.body.work.adultContent).toBe(false);
        await expect(readAdultContent(created.body.work.id)).resolves.toBe(false);
    });
    it('preserva vínculos legados e recusa associá-los a outra Obra', async () => {
        const legacyGenre = await createFreeOption('generos', 'genero-legado');
        const original = await createWorkThroughApi(sessionCookie, { suffix: 'preservar-legados' });
        const another = await createWorkThroughApi(sessionCookie, { suffix: 'novos-legados' });
        expect(original.status).toBe(201);
        expect(another.status).toBe(201);
        const workId = original.body.work.id;
        await db.query('UPDATE works SET type_id = $1 WHERE id = $2', [fixture.legacyType.id, workId]);
        await db.query('INSERT INTO work_genres (work_id, genre_id) VALUES ($1, $2)', [workId, legacyGenre.id]);
        const kept = await request(app).patch(`/api/admin/works/${workId}`).set('Cookie', sessionCookie)
            .send({ synopsis: 'Texto revisado.', typeId: fixture.legacyType.id, genreIds: [legacyGenre.id] });
        expect(kept.status).toBe(200);
        expect(kept.body.work.type.id).toBe(fixture.legacyType.id);
        expect(kept.body.work.genres.map(genre => genre.id)).toContain(legacyGenre.id);
        const country = await db.query(`SELECT value.id FROM domain_option_values value
            JOIN domain_option_categories category ON category.id = value.category_id
            WHERE category.slug = 'paises-origem' AND value.label = 'Japão'`);
        await db.query(`INSERT INTO domain_option_value_dependencies (dependent_value_id, depends_on_value_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING`, [fixture.legacyType.id, country.rows[0].id]);
        const rejectedType = await request(app).patch(`/api/admin/works/${another.body.work.id}`)
            .set('Cookie', sessionCookie).send({ typeId: fixture.legacyType.id });
        expect(rejectedType.status).toBe(400);
        const rejected = await request(app).patch(`/api/admin/works/${another.body.work.id}`)
            .set('Cookie', sessionCookie).send({ genreIds: [legacyGenre.id] });
        expect(rejected.status).toBe(400);
        const created = await createWorkThroughApi(sessionCookie, { suffix: 'recusar-legado', genreIds: [legacyGenre.id] });
        expect(created.status).toBe(400);
        const options = await request(app).get('/api/admin/works/form-options').set('Cookie', sessionCookie);
        expect(options.body.options.genres.map(genre => genre.id)).not.toContain(legacyGenre.id);
        expect(options.body.options.workTypes.map(type => type.id)).not.toContain(fixture.legacyType.id);
    });

});
