process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database');
const { createTestCover } = require('./helpers/cover');

const prefix = `calendar_${crypto.randomUUID().slice(0, 8)}`;
const fixture = { options: [], works: [], editions: [], users: [] };
const state = {};

async function option(category, suffix) {
    const label = `${prefix}-${suffix}`;
    const result = await db.query(`INSERT INTO domain_option_values(category_id,label,code)
        SELECT id,$2,$3 FROM domain_option_categories WHERE slug=$1 RETURNING id,label`,
    [category, label, category === 'autores' ? label : null]);
    fixture.options.push(result.rows[0].id);
    return result.rows[0];
}

async function work(suffix, visibility = 'Público', adult = false) {
    const title = `${prefix}-${suffix}`;
    const result = await db.query(`INSERT INTO works(cover_asset_id,slug,title,original_title,romanized_title,
        synopsis,type_id,country,original_publication_status,visibility,adult_content,atualizado_em)
        VALUES($1,$2::text,$2::text,$3,$4,$2::text,$5,'Japão','Completa',$6,$7,NOW()) RETURNING id,slug,title`,
    [await createTestCover(db, prefix), title, `${title}-original`, `${title}-romanized`, state.typeId, visibility, adult]);
    const row = result.rows[0];
    fixture.works.push(row.id);
    await db.query('INSERT INTO work_authors(work_id,author_id) VALUES($1,$2)', [row.id, state.author.id]);
    return row;
}

async function edition(workId, publisherId = state.publisher.id, visibility = 'Público', number = 1) {
    const result = await db.query(`INSERT INTO editions(work_id,brazilian_publisher_id,chronological_number,
        brazil_publication_status,visibility,atualizado_em)
        VALUES($1,$2,$3,'Completa',$4,NOW()) RETURNING id`, [workId, publisherId, number, visibility]);
    fixture.editions.push(result.rows[0].id);
    return result.rows[0].id;
}

async function volume(editionId, number, { year = 2035, month = 10, day = 15, visibility = 'Público' } = {}) {
    const precision = month === null ? 'Ano' : day === null ? 'Mes e ano' : 'Completa';
    const result = await db.query(`INSERT INTO volumes(edition_id,number,cover_asset_id,release_date_precision,
        release_year,release_month,release_day,visibility,atualizado_em)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
    [editionId, number, await createTestCover(db, prefix), precision, year, month, day, visibility]);
    return result.rows[0].id;
}

async function session(suffix, { age = 30, adult = true, admin = false, status = 'Ativada', revoked = false } = {}) {
    const result = await db.query(`INSERT INTO users(username,email,password_hash,status,nivel_acesso,birth_date,conteudo_adulto)
        VALUES($1,$2,'unused',$3,$4,CURRENT_DATE - make_interval(years => $5),$6) RETURNING id`,
    [`${prefix}-${suffix}`, `${prefix}-${suffix}@calendar.test`, status, admin ? 'Administrador' : 'Usuário Padrão', age, adult]);
    const userId = result.rows[0].id;
    fixture.users.push(userId);
    if (age === null) await db.query('UPDATE users SET birth_date=NULL WHERE id=$1', [userId]);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(`INSERT INTO sessions(user_id,session_token_hash,active_profile_id,revoked_at)
        SELECT $1,$2,id,$3 FROM profiles WHERE code='USUARIO_PADRAO'`,
    [userId, crypto.createHash('sha256').update(token).digest('hex'), revoked ? new Date() : null]);
    return `comanga_session=${token}`;
}

function calendar(query = {}, cookie) {
    const pending = request(app).get('/api/public/calendar').query({ year: 2035, month: 10, term: prefix, ...query });
    return cookie ? pending.set('Cookie', cookie) : pending;
}

describe('integração do calendário público', () => {
    beforeAll(async () => {
        state.typeId = (await db.query("SELECT id FROM domain_option_values WHERE code='manga'")).rows[0].id;
        state.author = await option('autores', 'author');
        state.publisher = await option('editoras-brasileiras', 'publisher');
        state.otherPublisher = await option('editoras-brasileiras', 'other-publisher');
        state.work = await work('livre');
        state.editionId = await edition(state.work.id);
        state.dayLater = await volume(state.editionId, 2, { day: 25 });
        state.dayFirst = await volume(state.editionId, 0, { day: 2 });
        state.sameDay = await volume(state.editionId, 3, { day: 2 });
        state.monthOnly = await volume(state.editionId, 4, { day: null });
        await volume(state.editionId, 5, { month: null, day: null });
        await volume(state.editionId, 6, { month: 11 });
        await volume(state.editionId, 7, { year: 2034 });
        await volume(state.editionId, 8, { visibility: 'Privado' });
        const current = new Date();
        state.currentVolume = await volume(state.editionId, 9, { year: current.getFullYear(), month: current.getMonth() + 1, day: 1 });
        await volume(await edition(state.work.id, state.publisher.id, 'Privado', 2), 1);
        state.otherVolume = await volume(await edition(state.work.id, state.otherPublisher.id, 'Público', 3), 1);
        await volume(await edition((await work('privada', 'Privado')).id), 1);
        state.adultVolume = await volume(await edition((await work('adulta', 'Público', true)).id), 1);
        const legacy = await work('legado-hentai');
        const hentai = (await db.query("SELECT id FROM domain_option_values WHERE code='hentai'")).rows[0].id;
        await db.query('INSERT INTO work_genres(work_id,genre_id) VALUES($1,$2)', [legacy.id, hentai]);
        state.legacyVolume = await volume(await edition(legacy.id), 1);
        state.cookies = {
            eligible: await session('eligible'),
            minor: await session('minor', { age: 17 }),
            disabled: await session('disabled', { adult: false }),
            noBirth: await session('no-birth', { age: null }),
            admin: await session('admin', { age: 17, adult: false, admin: true }),
            pending: await session('pending', { status: 'Pendente' }),
            revoked: await session('revoked', { revoked: true })
        };
    });

    afterAll(async () => {
        await db.query('DELETE FROM volumes WHERE edition_id=ANY($1::int[])', [fixture.editions]);
        await db.query('DELETE FROM editions WHERE id=ANY($1::int[])', [fixture.editions]);
        await db.query('DELETE FROM works WHERE id=ANY($1::int[])', [fixture.works]);
        await db.query('DELETE FROM domain_option_values WHERE id=ANY($1::int[])', [fixture.options]);
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [fixture.users]);
        await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${prefix}/%`]);
    });

    it('retorna somente Volumes do período com toda a hierarquia pública, datas conhecidas e ordem estável', async () => {
        const res = await calendar({ limit: 50 });
        expect(res.status).toBe(200);
        expect(res.body.volumes.map(({ id }) => id)).toEqual([
            state.dayFirst, state.sameDay, state.otherVolume, state.dayLater, state.monthOnly
        ]);
        expect(res.body).toMatchObject({ year: 2035, month: 10, pagination: { total: 5, totalPages: 1 } });
        const partial = res.body.volumes.at(-1);
        expect(partial).toMatchObject({ releaseDatePrecision: 'Mes e ano', releaseDay: null });
        expect(partial.coverUrl).toMatch(/^https:\/\/media\.example\.test\//);
        expect(Object.keys(partial).sort()).toEqual([
            'coverUrl', 'edition', 'id', 'number', 'releaseDatePrecision', 'releaseDay', 'releaseMonth', 'releaseYear', 'singleVolume'
        ]);
        expect(partial.edition).toEqual({
            id: state.editionId, chronologicalNumber: 1, brazilianPublisher: state.publisher,
            work: { ...state.work, originalTitle: `${state.work.title}-original` }
        });
        expect(res.headers.vary).toContain('Cookie');
        expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it.each(['title', 'original', 'romanized', 'author'])('combina editora e busca por %s', async (field) => {
        const term = field === 'author' ? state.author.label : field === 'title' ? state.work.title : `${state.work.title}-${field}`;
        const res = await calendar({ term: term.toUpperCase(), brazilianPublisherId: state.otherPublisher.id });
        expect(res.status).toBe(200);
        expect(res.body.volumes.map(({ id }) => id)).toEqual([state.otherVolume]);
    });

    it('pagina os resultados sem repetir itens e responde página fora do resultado vazia', async () => {
        const first = await calendar({ limit: 2 });
        const second = await calendar({ limit: 2, page: 2 });
        const outside = await calendar({ limit: 2, page: 4 });
        expect(first.body.pagination).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
        expect(first.body.volumes.map(({ id }) => id)).toEqual([state.dayFirst, state.sameDay]);
        expect(second.body.volumes.map(({ id }) => id)).toEqual([state.otherVolume, state.dayLater]);
        expect(outside.body.volumes).toEqual([]);
        expect(outside.body.pagination.total).toBe(5);
    });

    it('consulta o mês vigente sem parâmetros e outro mês vazio', async () => {
        const res = await request(app).get('/api/public/calendar').query({ term: prefix });
        expect(res.status).toBe(200);
        expect(res.body.volumes.map(({ id }) => id)).toEqual([state.currentVolume]);
        expect((await calendar({ month: 1 })).body.volumes).toEqual([]);
    });

    it.each([undefined, 'minor', 'disabled', 'noBirth', 'pending', 'revoked'])('oculta conteúdo adulto para viewer %s', async (viewer) => {
        const res = await calendar({}, state.cookies[viewer]);
        expect(res.status).toBe(200);
        expect(res.body.pagination.total).toBe(5);
        expect(res.body.volumes.map(({ id }) => id)).not.toEqual(expect.arrayContaining([state.adultVolume, state.legacyVolume]));
    });

    it.each(['eligible', 'admin'])('preserva regra adulta vigente de %s inclusive administrador com perfil padrão', async (viewer) => {
        const res = await calendar({}, state.cookies[viewer]);
        expect(res.status).toBe(200);
        expect(res.body.pagination.total).toBe(7);
        expect(res.body.volumes.map(({ id }) => id)).toEqual(expect.arrayContaining([state.adultVolume, state.legacyVolume]));
    });

    it.each([{ month: 13 }, { year: 1899 }, { page: 0 }, { limit: 51 }, { brazilianPublisherId: -1 }, { month: [1, 2] }])('rejeita parâmetros inválidos %j com erro público consistente', async (query) => {
        const res = await calendar(query);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Filtros de consulta inválidos.' });
    });
});
