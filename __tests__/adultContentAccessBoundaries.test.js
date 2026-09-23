process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const crypto = require('node:crypto');
const request = require('supertest');

const { createTestCover } = require('./helpers/cover');
const app = require('../src/app');
const db = require('../src/database');

const prefix = `adult_bound_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const emailDomain = 'adult-boundaries-test.local';
const PUBLIC = 'Público';

const fixture = { optionIds: [], workIds: [], editionIds: [], userIds: [], options: {} };

async function ensureCategory(slug) {
    const result = await db.query(
        `INSERT INTO domain_option_categories (slug, name) VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = domain_option_categories.name RETURNING id`,
        [slug, `${prefix}_${slug}`]
    );
    return result.rows[0].id;
}

async function createOption(categorySlug, suffix) {
    const categoryId = await ensureCategory(categorySlug);
    const label = `${prefix}_${suffix}`;
    const result = await db.query(
        `INSERT INTO domain_option_values (category_id, label, code, active)
         VALUES ($1, $2, $3, true) RETURNING id, label, code`,
        [categoryId, label, categorySlug === 'autores' ? label.toLowerCase().replace(/_/g, '-') : null]
    );
    fixture.optionIds.push(result.rows[0].id);
    return result.rows[0];
}

async function createWork(suffix, adultContent) {
    const result = await db.query(
        `INSERT INTO works (cover_asset_id, slug, title, romanized_title, synopsis, type_id, country,
            original_publication_status, visibility, adult_content, atualizado_em)
         VALUES ('${await createTestCover(db, prefix)}', $1, $2::text, $2::text, $2::text, $3, 'Japão', 'Completa', $4, $5, NOW())
         RETURNING id, slug`,
        [
            `${prefix}-${suffix}`.toLowerCase().replace(/_/g, '-'),
            `${prefix}_${suffix}`,
            fixture.options.type.id,
            PUBLIC,
            adultContent
        ]
    );
    const work = result.rows[0];
    fixture.workIds.push(work.id);
    await db.query('INSERT INTO work_authors (work_id, author_id) VALUES ($1, $2)', [work.id, fixture.options.author.id]);
    return work;
}

async function createEditionWithVolume(workId) {
    const edition = await db.query(
        `INSERT INTO editions (work_id, brazilian_publisher_id,
            cover_type_id, format_id, chronological_number, brazil_publication_status, visibility, atualizado_em)
         VALUES ($1, $2, $3, $4, 1, 'Completa', $5, NOW())
         RETURNING id`,
        [
            workId,
            fixture.options.publisher.id,
            fixture.options.coverType.id,
            fixture.options.format.id,
            PUBLIC
        ]
    );
    const editionId = edition.rows[0].id;
    fixture.editionIds.push(editionId);
    const volume = await db.query(
        `INSERT INTO volumes (cover_asset_id, edition_id, number, release_date_precision,
            release_year, visibility, atualizado_em)
         VALUES ('${await createTestCover(db, prefix)}', $1, 1, 'Ano', 2026, $2, NOW())
         RETURNING id`,
        [editionId, PUBLIC]
    );
    return { editionId, volumeId: volume.rows[0].id };
}

async function createSessionCookie({ suffix, birthDateSql, adultContent = true, status = 'Ativada' }) {
    const user = await db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, birth_date, conteudo_adulto)
         VALUES ($1, $2, 'not-used', $3, 'Usuário Padrão', ${birthDateSql}, $4)
         RETURNING id`,
        [`${prefix}_${suffix}`.slice(0, 50), `${prefix}_${suffix}@${emailDomain}`, status, adultContent]
    );
    fixture.userIds.push(user.rows[0].id);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
        'INSERT INTO sessions (user_id, session_token_hash) VALUES ($1, $2)',
        [user.rows[0].id, crypto.createHash('sha256').update(token).digest('hex')]
    );
    return `comanga_session=${token}`;
}

describe('fronteiras de acesso a conteúdo adulto nas leituras públicas', () => {
    const state = {};

    beforeAll(async () => {
        fixture.options.author = await createOption('autores', 'autor');
        fixture.options.type = await createOption('tipos-obra', 'tipo');
        fixture.options.publisher = await createOption('editoras-brasileiras', 'editora');
        fixture.options.format = await createOption('formatos-fisicos', 'formato');
        fixture.options.coverType = await createOption('tipos-capa', 'capa');

        state.livre = await createWork('livre', false);
        state.adulta = await createWork('adulta', true);
        Object.assign(state, await createEditionWithVolume(state.adulta.id));

        state.cookies = {
            completou18Hoje: await createSessionCookie({
                suffix: 'hoje',
                birthDateSql: "CURRENT_DATE - INTERVAL '18 years'"
            }),
            completa18Amanha: await createSessionCookie({
                suffix: 'amanha',
                birthDateSql: "CURRENT_DATE - INTERVAL '18 years' + INTERVAL '1 day'"
            }),
            semNascimento: await createSessionCookie({
                suffix: 'legado',
                birthDateSql: 'NULL'
            }),
            preferenciaDesligada: await createSessionCookie({
                suffix: 'preferencia',
                birthDateSql: "CURRENT_DATE - INTERVAL '30 years'",
                adultContent: false
            })
        };
    });

    afterAll(async () => {
        if (fixture.editionIds.length > 0) {
            await db.query('DELETE FROM volumes WHERE edition_id = ANY($1::int[])', [fixture.editionIds]);
            await db.query('DELETE FROM editions WHERE id = ANY($1::int[])', [fixture.editionIds]);
        }
        if (fixture.workIds.length > 0) {
            await db.query('DELETE FROM work_authors WHERE work_id = ANY($1::int[])', [fixture.workIds]);
            await db.query('DELETE FROM works WHERE id = ANY($1::int[])', [fixture.workIds]);
        }
        await db.query('DELETE FROM users WHERE email LIKE $1', [`${prefix}%@${emailDomain}`]);
        if (fixture.optionIds.length > 0) {
            await db.query('DELETE FROM domain_option_values WHERE id = ANY($1::int[])', [fixture.optionIds]);
        }
        await db.query("DELETE FROM media_assets WHERE object_key LIKE $1", [`${prefix}/%`]);
    });

    // As chaves são resolvidas dentro do teste porque os fixtures nascem no beforeAll.
    const NAO_AUTORIZADOS = [
        ['visitante anônimo', null],
        ['conta que completa 18 anos amanhã', 'completa18Amanha'],
        ['conta legada sem data de nascimento', 'semNascimento'],
        ['conta adulta com preferência desligada', 'preferenciaDesligada']
    ];

    function get(path, cookie) {
        const pending = request(app).get(path);
        return cookie ? pending.set('Cookie', cookie) : pending;
    }

    describe('consulta direta às fichas restritas', () => {
        it.each(NAO_AUTORIZADOS)('responde 404 de Obra, Edição e Volume adultos para %s', async (_nome, chave) => {
            const cookie = chave ? state.cookies[chave] : undefined;
            const [obra, edicao, volume] = await Promise.all([
                get(`/api/public/works/${state.adulta.slug}`, cookie),
                get(`/api/public/editions/${state.editionId}`, cookie),
                get(`/api/public/volumes/${state.volumeId}`, cookie)
            ]);

            for (const response of [obra, edicao, volume]) {
                expect(response.status).toBe(404);
                expect(JSON.stringify(response.body)).not.toContain(prefix);
            }
        });

        it('libera Obra, Edição e Volume adultos no dia exato dos 18 anos', async () => {
            const cookie = state.cookies.completou18Hoje;
            const [obra, edicao, volume] = await Promise.all([
                get(`/api/public/works/${state.adulta.slug}`, cookie),
                get(`/api/public/editions/${state.editionId}`, cookie),
                get(`/api/public/volumes/${state.volumeId}`, cookie)
            ]);

            expect(obra.status).toBe(200);
            expect(obra.body.work.id).toBe(state.adulta.id);
            expect(edicao.status).toBe(200);
            expect(edicao.body.edition.id).toBe(state.editionId);
            expect(volume.status).toBe(200);
            expect(volume.body.volume.id).toBe(state.volumeId);
        });
    });

    describe('listagens, contagens e paginação', () => {
        it.each(NAO_AUTORIZADOS)('não conta a Obra adulta no total nem no total de páginas para %s', async (_nome, chave) => {
            const cookie = chave ? state.cookies[chave] : undefined;
            const [pesquisa, porAutor] = await Promise.all([
                get(`/api/public/works?term=${prefix}&limit=1`, cookie),
                get(`/api/public/authors/${fixture.options.author.code}/works?limit=1`, cookie)
            ]);

            expect(pesquisa.status).toBe(200);
            expect(pesquisa.body.works.map((work) => work.id)).toEqual([state.livre.id]);
            expect(pesquisa.body.pagination).toMatchObject({ total: 1, totalPages: 1 });

            expect(porAutor.status).toBe(200);
            expect(porAutor.body.works.map((work) => work.id)).toEqual([state.livre.id]);
            expect(porAutor.body.pagination).toMatchObject({ total: 1, totalPages: 1 });
        });

        it('conta as duas Obras para quem está autorizado a ver conteúdo adulto', async () => {
            const cookie = state.cookies.completou18Hoje;
            const [pesquisa, porAutor] = await Promise.all([
                get(`/api/public/works?term=${prefix}&limit=1`, cookie),
                get(`/api/public/authors/${fixture.options.author.code}/works?limit=1`, cookie)
            ]);

            expect(pesquisa.body.pagination).toMatchObject({ total: 2, totalPages: 2 });
            expect(porAutor.body.pagination).toMatchObject({ total: 2, totalPages: 2 });
        });

        it('não expõe a Edição adulta na listagem pública de Edições', async () => {
            const anonimo = await get(`/api/public/editions?term=${prefix}`);
            const autorizado = await get(`/api/public/editions?term=${prefix}`, state.cookies.completou18Hoje);

            expect(anonimo.body.editions).toEqual([]);
            expect(anonimo.body.pagination).toMatchObject({ total: 0, totalPages: 0 });
            expect(autorizado.body.editions.map((edition) => edition.id)).toEqual([state.editionId]);
        });
    });

    describe('cache das respostas dependentes da sessão', () => {
        it.each([
            ['pesquisa de Obras', () => `/api/public/works?term=${prefix}`],
            ['detalhes de Volume', () => `/api/public/volumes/${state.volumeId}`]
        ])('marca %s como privada e variável por cookie', async (_nome, buildPath) => {
            const response = await get(buildPath(), state.cookies.completou18Hoje);

            expect(response.headers.vary).toContain('Cookie');
            expect(response.headers['cache-control']).toBe('private, no-store');
        });
    });
});
