const crypto = require('node:crypto');
const request = require('supertest');

const db = require('../src/database');
const app = require('../src/app');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const fixturePrefix = `public_catalog_${runId}`;
const fixtureEmailDomain = 'public-catalog-test.local';
const PUBLIC_VISIBILITY = 'P\u00fablico';
const PRIVATE_VISIBILITY = 'Privado';

const fixture = {
    optionIds: [],
    workIds: [],
    editionIds: [],
    userIds: [],
    options: {},
    works: {},
    editions: {}
};

async function ensureCategory(slug) {
    const result = await db.query(
        `INSERT INTO domain_option_categories (slug, name)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = domain_option_categories.name
         RETURNING id`,
        [slug, `${fixturePrefix}_${slug}`]
    );

    return result.rows[0].id;
}

async function createOption(categorySlug, suffix, active = true) {
    const categoryId = await ensureCategory(categorySlug);
    const result = await db.query(
        `INSERT INTO domain_option_values (category_id, label, active)
         VALUES ($1, $2, $3)
         RETURNING id, label`,
        [categoryId, `${fixturePrefix}_${suffix}`, active]
    );

    fixture.optionIds.push(result.rows[0].id);
    return result.rows[0];
}

async function createWork({
    suffix,
    originalTitle = null,
    typeId = fixture.options.typeOne.id,
    country = 'Jap\u00e3o',
    visibility = PUBLIC_VISIBILITY,
    adultContent = false,
    authorIds = [fixture.options.authorOne.id],
    genreIds = [],
    demographics = []
}) {
    const title = `${fixturePrefix}_${suffix}`;
    const slug = `${fixturePrefix}-${suffix}`.toLowerCase().replace(/_/g, '-');
    const result = await db.query(
        `INSERT INTO works (
            slug,
            title,
            original_title,
            type_id,
            country,
            original_publication_status,
            cover_url,
            visibility,
            adult_content,
            atualizado_em
         ) VALUES ($1, $2, $3, $4, $5, 'Completo', $6, $7, $8, NOW())
         RETURNING id, slug, title`,
        [slug, title, originalTitle, typeId, country, `https://example.com/${slug}.jpg`, visibility, adultContent]
    );
    const work = result.rows[0];
    fixture.workIds.push(work.id);

    for (const authorId of authorIds) {
        await db.query(
            'INSERT INTO work_authors (work_id, author_id) VALUES ($1, $2)',
            [work.id, authorId]
        );
    }

    for (const genreId of genreIds) {
        await db.query(
            'INSERT INTO work_genres (work_id, genre_id) VALUES ($1, $2)',
            [work.id, genreId]
        );
    }

    for (const demography of demographics) {
        await db.query(
            'INSERT INTO work_demographies (work_id, demography) VALUES ($1, $2)',
            [work.id, demography]
        );
    }

    return work;
}

async function createEdition({
    workId,
    chronologicalNumber,
    visibility = PUBLIC_VISIBILITY,
    brazilianPublisherId = fixture.options.publisherOne.id,
    formatId = fixture.options.formatOne.id,
    coverTypeId = fixture.options.coverOne.id
}) {
    const result = await db.query(
        `INSERT INTO editions (
            work_id,
            brazilian_publisher_id,
            edition_type_id,
            cover_type_id,
            format_id,
            chronological_number,
            brazil_publication_status,
            cover_url,
            visibility,
            atualizado_em
         ) VALUES ($1, $2, $3, $4, $5, $6, 'Completo', $7, $8, NOW())
         RETURNING id`,
        [
            workId,
            brazilianPublisherId,
            fixture.options.editionType.id,
            coverTypeId,
            formatId,
            chronologicalNumber,
            `https://example.com/edition-${workId}-${chronologicalNumber}.jpg`,
            visibility
        ]
    );

    fixture.editionIds.push(result.rows[0].id);
    return result.rows[0];
}

async function createVolume(editionId, number, visibility = PRIVATE_VISIBILITY) {
    await db.query(
        `INSERT INTO volumes (
            edition_id,
            number,
            cover_url,
            release_date_precision,
            release_year,
            visibility,
            atualizado_em
         ) VALUES ($1, $2, $3, 'Ano', 2026, $4, NOW())`,
        [editionId, number, `https://example.com/volume-${editionId}-${number}.jpg`, visibility]
    );
}

async function createSessionCookie({ status = 'Ativada', adultContent = false, suffix }) {
    const userResult = await db.query(
        `INSERT INTO users (
            username,
            email,
            password_hash,
            status,
            nivel_acesso,
            conteudo_adulto
         ) VALUES ($1, $2, 'not-used', $3, 'Usu\u00e1rio Padr\u00e3o', $4)
        RETURNING id`,
        [
            `${suffix}_${fixturePrefix}`.slice(0, 50),
            `${fixturePrefix}_${suffix}@${fixtureEmailDomain}`,
            status,
            adultContent
        ]
    );
    const userId = userResult.rows[0].id;
    fixture.userIds.push(userId);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.query(
        'INSERT INTO sessions (user_id, session_token_hash) VALUES ($1, $2)',
        [userId, tokenHash]
    );

    return `comanga_session=${token}`;
}

async function deleteFixtures() {
    if (fixture.editionIds.length > 0) {
        await db.query('DELETE FROM volumes WHERE edition_id = ANY($1::int[])', [fixture.editionIds]);
        await db.query('DELETE FROM editions WHERE id = ANY($1::int[])', [fixture.editionIds]);
    }

    if (fixture.workIds.length > 0) {
        await db.query('DELETE FROM works WHERE id = ANY($1::int[])', [fixture.workIds]);
    }

    if (fixture.userIds.length > 0) {
        await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.userIds]);
    }

    if (fixture.optionIds.length > 0) {
        await db.query('DELETE FROM domain_option_values WHERE id = ANY($1::int[])', [fixture.optionIds]);
    }
}

describe('catálogo público', () => {
    beforeAll(async () => {
        fixture.options.typeOne = await createOption('tipos-obra', 'type-one');
        fixture.options.typeTwo = await createOption('tipos-obra', 'type-two');
        fixture.options.authorOne = await createOption('autores', 'author-one');
        fixture.options.authorTwo = await createOption('autores', 'author-two');
        fixture.options.genreOne = await createOption('generos', 'genre-one');
        fixture.options.genreTwo = await createOption('generos', 'genre-two');
        fixture.options.inactiveGenre = await createOption('generos', 'genre-inactive', false);
        fixture.options.publisherOne = await createOption('editoras-brasileiras', 'publisher-one');
        fixture.options.publisherTwo = await createOption('editoras-brasileiras', 'publisher-two');
        fixture.options.editionType = await createOption('tipos-edicao', 'edition-type');
        fixture.options.coverOne = await createOption('tipos-capa', 'cover-one');
        fixture.options.coverTwo = await createOption('tipos-capa', 'cover-two');
        fixture.options.formatOne = await createOption('formatos-fisicos', 'format-one');
        fixture.options.formatTwo = await createOption('formatos-fisicos', 'format-two');

        fixture.works.complete = await createWork({
            suffix: 'alpha',
            originalTitle: `${fixturePrefix}_original-alpha`,
            authorIds: [fixture.options.authorOne.id],
            genreIds: [fixture.options.genreOne.id, fixture.options.genreTwo.id],
            demographics: ['Shonen', 'Seinen']
        });
        fixture.works.partial = await createWork({
            suffix: 'partial',
            typeId: fixture.options.typeTwo.id,
            country: 'Coreia do Sul',
            authorIds: [fixture.options.authorTwo.id],
            genreIds: [fixture.options.genreOne.id],
            demographics: ['Shonen']
        });
        fixture.works.adult = await createWork({
            suffix: 'adult',
            adultContent: true,
            genreIds: [fixture.options.genreOne.id],
            demographics: ['Seinen']
        });
        fixture.works.private = await createWork({
            suffix: 'private',
            visibility: PRIVATE_VISIBILITY,
            genreIds: [fixture.options.genreOne.id],
            demographics: ['Shonen']
        });

        fixture.editions.complete = await createEdition({
            workId: fixture.works.complete.id,
            chronologicalNumber: 1
        });
        fixture.editions.private = await createEdition({
            workId: fixture.works.complete.id,
            chronologicalNumber: 2,
            visibility: PRIVATE_VISIBILITY
        });
        fixture.editions.partial = await createEdition({
            workId: fixture.works.partial.id,
            chronologicalNumber: 1,
            brazilianPublisherId: fixture.options.publisherTwo.id,
            formatId: fixture.options.formatTwo.id,
            coverTypeId: fixture.options.coverTwo.id
        });
        fixture.editions.adult = await createEdition({
            workId: fixture.works.adult.id,
            chronologicalNumber: 1
        });
        fixture.editions.privateWork = await createEdition({
            workId: fixture.works.private.id,
            chronologicalNumber: 1
        });

        await createVolume(fixture.editions.complete.id, 1, PUBLIC_VISIBILITY);
        await createVolume(fixture.editions.complete.id, 2, PRIVATE_VISIBILITY);
    });

    afterAll(deleteFixtures);

    describe('GET /api/public/works', () => {
    it('permite acesso an\u00f4nimo e nunca exp\u00f5e Obras privadas ou adultas', async () => {
        const response = await request(app)
            .get('/api/public/works')
            .query({ term: fixturePrefix, limit: 50 });

        expect(response.status).toBe(200);
        expect(response.body.works.map((work) => work.id)).toEqual([
            fixture.works.complete.id,
            fixture.works.partial.id
        ]);
        expect(response.body.works[0]).toEqual(expect.objectContaining({
            id: fixture.works.complete.id,
            slug: fixture.works.complete.slug,
            title: fixture.works.complete.title,
            originalTitle: `${fixturePrefix}_original-alpha`,
            coverUrl: expect.any(String),
            type: expect.objectContaining({ id: fixture.options.typeOne.id }),
            country: 'Jap\u00e3o',
            authors: [{
                id: fixture.options.authorOne.id,
                label: fixture.options.authorOne.label
            }]
        }));
        expect(response.body.works[0]).not.toHaveProperty('adultContent');
        expect(response.body.works[0]).not.toHaveProperty('visibility');
    });

    it('busca por t\u00edtulo original e Autor sem expor campos administrativos', async () => {
        const byOriginalTitle = await request(app)
            .get('/api/public/works')
            .query({ term: `${fixturePrefix}_original-alpha` });
        const byAuthor = await request(app)
            .get('/api/public/works')
            .query({ term: fixture.options.authorTwo.label });

        expect(byOriginalTitle.status).toBe(200);
        expect(byOriginalTitle.body.works.map((work) => work.id)).toEqual([fixture.works.complete.id]);
        expect(byAuthor.status).toBe(200);
        expect(byAuthor.body.works.map((work) => work.id)).toEqual([fixture.works.partial.id]);
    });

    it('combina grupos com E e exige todos os G\u00eaneros e Demografias selecionados', async () => {
        const response = await request(app)
            .get('/api/public/works')
            .query({
                term: fixturePrefix,
                typeId: fixture.options.typeOne.id,
                country: 'Jap\u00e3o',
                genreIds: `${fixture.options.genreOne.id},${fixture.options.genreTwo.id}`,
                demographics: 'Shonen,Seinen'
            });

        expect(response.status).toBe(200);
        expect(response.body.works.map((work) => work.id)).toEqual([fixture.works.complete.id]);
    });

    it('trata cookie inv\u00e1lido como visitante e s\u00f3 libera +18 para conta ativa com prefer\u00eancia', async () => {
        const invalidSession = await request(app)
            .get('/api/public/works')
            .set('Cookie', 'comanga_session=invalid')
            .query({ term: `${fixturePrefix}_adult` });
        const preferenceDisabledCookie = await createSessionCookie({
            suffix: 'adult-disabled',
            adultContent: false
        });
        const preferenceDisabled = await request(app)
            .get('/api/public/works')
            .set('Cookie', preferenceDisabledCookie)
            .query({ term: `${fixturePrefix}_adult` });
        const blockedCookie = await createSessionCookie({
            suffix: 'adult-blocked',
            status: 'Bloqueada',
            adultContent: true
        });
        const blocked = await request(app)
            .get('/api/public/works')
            .set('Cookie', blockedCookie)
            .query({ term: `${fixturePrefix}_adult` });
        const allowedCookie = await createSessionCookie({
            suffix: 'adult-enabled',
            adultContent: true
        });
        const allowed = await request(app)
            .get('/api/public/works')
            .set('Cookie', allowedCookie)
            .query({ term: `${fixturePrefix}_adult` });

        expect(invalidSession.status).toBe(200);
        expect(invalidSession.body.works).toEqual([]);
        expect(preferenceDisabled.body.works).toEqual([]);
        expect(blocked.body.works).toEqual([]);
        expect(allowed.body.works.map((work) => work.id)).toEqual([fixture.works.adult.id]);
    });

    it('aplica pagina\u00e7\u00e3o determin\u00edstica e limita a no m\u00e1ximo 50 registros', async () => {
        const firstPage = await request(app)
            .get('/api/public/works')
            .query({ term: fixturePrefix, page: 1, limit: 1 });
        const secondPage = await request(app)
            .get('/api/public/works')
            .query({ term: fixturePrefix, page: 2, limit: 1 });
        const invalidLimit = await request(app)
            .get('/api/public/works')
            .query({ limit: 51 });

        expect(firstPage.status).toBe(200);
        expect(firstPage.body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
        expect(firstPage.body.works[0].id).not.toBe(secondPage.body.works[0].id);
        expect(invalidLimit.status).toBe(400);
    });
    });

    describe('GET /api/public/editions', () => {
    it('busca pela identidade da Obra, exige ambas as visibilidades e herda a regra adulta', async () => {
        const response = await request(app)
            .get('/api/public/editions')
            .query({ term: fixturePrefix, limit: 50 });

        expect(response.status).toBe(200);
        expect(response.body.editions.map((edition) => edition.id)).toEqual([
            fixture.editions.complete.id,
            fixture.editions.partial.id
        ]);
        expect(response.body.editions[0]).toEqual(expect.objectContaining({
            id: fixture.editions.complete.id,
            chronologicalNumber: 1,
            coverUrl: expect.any(String),
            work: expect.objectContaining({
                id: fixture.works.complete.id,
                slug: fixture.works.complete.slug,
                title: fixture.works.complete.title,
                authors: [{
                    id: fixture.options.authorOne.id,
                    label: fixture.options.authorOne.label
                }]
            }),
            brazilianPublisher: {
                id: fixture.options.publisherOne.id,
                label: fixture.options.publisherOne.label
            },
            format: {
                id: fixture.options.formatOne.id,
                label: fixture.options.formatOne.label
            },
            coverType: {
                id: fixture.options.coverOne.id,
                label: fixture.options.coverOne.label
            },
            volumesCount: 2
        }));
        expect(response.body.editions[0]).not.toHaveProperty('visibility');
    });

    it('combina busca de Autor com Editora Brasileira, Formato e Acabamento', async () => {
        const response = await request(app)
            .get('/api/public/editions')
            .query({
                term: fixture.options.authorOne.label,
                brazilianPublisherId: fixture.options.publisherOne.id,
                formatId: fixture.options.formatOne.id,
                coverTypeId: fixture.options.coverOne.id
            });

        expect(response.status).toBe(200);
        expect(response.body.editions.map((edition) => edition.id)).toEqual([fixture.editions.complete.id]);
    });

    it('libera Edi\u00e7\u00e3o adulta apenas com sess\u00e3o eleg\u00edvel e valida limite', async () => {
        const cookie = await createSessionCookie({ suffix: 'edition-adult', adultContent: true });
        const allowed = await request(app)
            .get('/api/public/editions')
            .set('Cookie', cookie)
            .query({ term: `${fixturePrefix}_adult` });
        const invalidLimit = await request(app)
            .get('/api/public/editions')
            .query({ limit: 0 });

        expect(allowed.status).toBe(200);
        expect(allowed.body.editions.map((edition) => edition.id)).toEqual([fixture.editions.adult.id]);
        expect(invalidLimit.status).toBe(400);
    });
    });

    describe('GET /api/public/catalog-options', () => {
    it('oferece apenas op\u00e7\u00f5es ativas necess\u00e1rias \u00e0s duas vitrines', async () => {
        const response = await request(app).get('/api/public/catalog-options');

        expect(response.status).toBe(200);
        expect(response.body.options.workTypes).toEqual(expect.arrayContaining([fixture.options.typeOne]));
        expect(response.body.options.genres).toEqual(expect.arrayContaining([fixture.options.genreOne]));
        expect(response.body.options.genres).not.toEqual(expect.arrayContaining([fixture.options.inactiveGenre]));
        expect(response.body.options.brazilianPublishers).toEqual(expect.arrayContaining([fixture.options.publisherOne]));
        expect(response.body.options.formats).toEqual(expect.arrayContaining([fixture.options.formatOne]));
        expect(response.body.options.coverTypes).toEqual(expect.arrayContaining([fixture.options.coverOne]));
        expect(response.body.options.countries).toEqual(['China', 'Coreia do Sul', 'Jap\u00e3o', 'Taiwan']);
        expect(response.body.options.demographics).toEqual(['Josei', 'Kodomo', 'Seinen', 'Shonen', 'Shoujo']);
        expect(response.body.options).not.toHaveProperty('authors');
    });
    });
});
