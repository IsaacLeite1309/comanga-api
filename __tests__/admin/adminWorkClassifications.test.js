process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const request = require('supertest');
const bcrypt = require('bcrypt');

const { createTestCover } = require('../helpers/cover');
const db = require('../../src/database');
const app = require('../../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const fixturePrefix = `work_class_${runId}`;
const testEmailDomain = 'work-classifications-test.local';
const validPassword = 'SenhaForte123!';

jest.setTimeout(60000);

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

        originalPublicationStatus: 'Completa',
        coverAssetId: overrides.coverAssetId,
        authors: [{ authorId: fixture.author.id, roles: ['História e Arte'] }],
        genreIds: overrides.genreIds || [],
        demographies: overrides.demographies || [],
        adultContent: overrides.adultContent === undefined ? false : overrides.adultContent,
        ...(overrides.typeId ? { typeId: overrides.typeId } : {})
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
        fixture.lightNovelType = await findOfficialOption('tipos-obra', 'light-novel');
        fixture.hentai = await findOfficialOption('generos', 'hentai');
        fixture.boysLove = await findOfficialOption('generos', 'boys-love');
        fixture.girlsLove = await findOfficialOption('generos', 'girls-love');
        fixture.drama = await findOfficialOption('generos', 'drama');
        fixture.author = await createFreeOption('autores', 'autor');
        fixture.legacyType = await createFreeOption('tipos-obra', 'tipo-legado');
        sessionCookie = await insertAdmin();
    });

    afterAll(deleteFixtures);

    it('filtra demografia em conjunto com tipo e visibilidade e mantém contagem e paginação', async () => {
        const first = await createWorkThroughApi(sessionCookie, { suffix: 'demography-filter-a', demographies: ['Shonen'] });
        const second = await createWorkThroughApi(sessionCookie, { suffix: 'demography-filter-b', demographies: ['Seinen'] });
        const third = await createWorkThroughApi(sessionCookie, { suffix: 'demography-filter-c', demographies: ['Shonen', 'Seinen'] });
        const without = await createWorkThroughApi(sessionCookie, { suffix: 'demography-filter-d' });
        for (const response of [first, second, third, without]) expect(response.status).toBe(201);
        const query = { term: `${fixturePrefix}_demography-filter`, demography: 'Seinen', typeId: fixture.mangaType.id, visibility: 'Privado', limit: 1 };
        const result = await request(app).get('/api/admin/works').set('Cookie', sessionCookie).query(query);
        expect(result.status).toBe(200);
        expect(result.body.works.map(work => work.id)).toEqual([second.body.work.id]);
        expect(result.body.pagination).toMatchObject({ total: 2, totalPages: 2, page: 1 });
        const next = await request(app).get('/api/admin/works').set('Cookie', sessionCookie).query({ ...query, page: 2 });
        expect(next.body.works.map(work => work.id)).toEqual([third.body.work.id]);
        const invalid = await request(app).get('/api/admin/works').set('Cookie', sessionCookie).query({ demography: 'Adulto' });
        expect(invalid.status).toBe(400);
    });

    it('recusa remover todos os autores e preserva vínculos e créditos', async () => {
        const created = await createWorkThroughApi(sessionCookie, { suffix: 'integridade-autores' });
        expect(created.status).toBe(201);
        const workId = created.body.work.id;
        const response = await request(app).patch(`/api/admin/works/${workId}`)
            .set('Cookie', sessionCookie).send({ authors: [] });
        expect(response.status).toBe(400);
        const unchanged = await request(app).get(`/api/admin/works/${workId}`).set('Cookie', sessionCookie);
        expect(unchanged.body.work.authors).toEqual(created.body.work.authors);

        const omitted = await request(app).patch(`/api/admin/works/${workId}`)
            .set('Cookie', sessionCookie).send({ synopsis: 'Sinopse revisada sem alterar autoria.' });
        expect(omitted.status).toBe(200);
        expect(omitted.body.work.authors).toEqual(created.body.work.authors);
    });

    it.each([
        ['fim anterior ao início salvo', { originalPublicationEndYear: 2010 }, 400, 2020, 2024],
        ['início posterior ao fim salvo', { originalPublicationStartYear: 2030 }, 400, 2020, 2024],
        ['fim igual ao início', { originalPublicationEndYear: 2020 }, 200, 2020, 2020],
        ['início igual ao fim', { originalPublicationStartYear: 2024 }, 200, 2024, 2024],
        ['fim ausente', { originalPublicationEndYear: null }, 200, 2020, null],
        ['início ausente', { originalPublicationStartYear: null }, 200, null, 2024],
        ['troca completa de período', { originalPublicationStartYear: 2000, originalPublicationEndYear: 2010 }, 200, 2000, 2010],
        ['remove início e altera fim', { originalPublicationStartYear: null, originalPublicationEndYear: 2010 }, 200, null, 2010]
    ])('valida o período final de uma atualização parcial: %s', async (label, patch, status, start, end) => {
        const created = await createWorkThroughApi(sessionCookie, { suffix: `periodo-${label}` });
        expect(created.status).toBe(201);
        const workId = created.body.work.id;
        const initial = await request(app).patch(`/api/admin/works/${workId}`).set('Cookie', sessionCookie)
            .send({ originalPublicationStartYear: 2020, originalPublicationEndYear: 2024 });
        expect(initial.status).toBe(200);
        const response = await request(app).patch(`/api/admin/works/${workId}`).set('Cookie', sessionCookie).send(patch);
        expect(response.status).toBe(status);
        const persisted = await db.query(`SELECT original_publication_start_year AS start,
            original_publication_end_year AS end FROM works WHERE id=$1`, [workId]);
        expect(persisted.rows[0]).toEqual({ start, end });
    });

    it.each(['manga', 'light-novel', 'novel', 'artbook', 'databook'])
    ('permite criar e atualizar o tipo %s sem país', async (code) => {
        const type = await findOfficialOption('tipos-obra', code);
        const created = await createWorkThroughApi(sessionCookie, { suffix: 'type-create-' + code, typeId: type.id });
        expect(created.status).toBe(201);
        expect(created.body.work).not.toHaveProperty('country');
        const existing = await createWorkThroughApi(sessionCookie, { suffix: 'type-update-' + code });
        const updated = await request(app).patch('/api/admin/works/' + existing.body.work.id)
            .set('Cookie', sessionCookie).send({ typeId: type.id });
        expect(updated.status).toBe(200);
        expect(updated.body.work.type.id).toBe(type.id);
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

    it.each([
        ['boys-love', 'boysLove'],
        ['girls-love', 'girlsLove']
    ])('não guarda demografia para Obra com %s no cadastro ou na edição', async (code, key) => {
        const created = await createWorkThroughApi(sessionCookie, {
            suffix: `sem-demografia-${code}`,
            genreIds: [fixture[key].id],
            demographies: ['Shonen']
        });
        expect(created.status).toBe(201);
        expect(created.body.work.demographics).toEqual([]);

        const workId = created.body.work.id;
        const attempted = await request(app).patch(`/api/admin/works/${workId}`)
            .set('Cookie', sessionCookie).send({ demographies: ['Seinen'] });
        expect(attempted.status).toBe(200);
        expect(attempted.body.work.demographics).toEqual([]);

        const removedGenre = await request(app).patch(`/api/admin/works/${workId}`)
            .set('Cookie', sessionCookie).send({ genreIds: [fixture.drama.id], demographies: ['Josei'] });
        expect(removedGenre.status).toBe(200);
        expect(removedGenre.body.work.demographics).toEqual(['Josei']);

        const addedGenre = await request(app).patch(`/api/admin/works/${workId}`)
            .set('Cookie', sessionCookie).send({ genreIds: [fixture[key].id] });
        expect(addedGenre.status).toBe(200);
        expect(addedGenre.body.work.demographics).toEqual([]);
    });

    it('recusa tipo de Obra inexistente', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'tipo-invalido',
            typeId: 2147483647,

        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Um ou mais valores selecionados são inválidos.');
    });

    it('recusa tipo de Obra legado para novos vínculos', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'tipo-sem-dependencia',
            typeId: fixture.legacyType.id,

        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Um ou mais valores selecionados são inválidos.');
    });

    it('aceita tipo oficial sem restringir pelo país de um cliente antigo', async () => {
        const response = await createWorkThroughApi(sessionCookie, {
            suffix: 'light-novel-sem-pais',
            typeId: fixture.lightNovelType.id,

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
