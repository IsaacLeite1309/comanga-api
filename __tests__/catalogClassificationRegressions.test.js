process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const { setTimeout: delay } = require('node:timers/promises');
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database');
const { createTestCover } = require('./helpers/cover');

jest.setTimeout(30000);
const prefix = `classification_regression_${crypto.randomUUID()}`;
let cookie;
let mangaId;
let hentaiId;
let categoryId;
const optionIds = [];

async function createWork(suffix) {
    const result = await db.query(`INSERT INTO works
        (title,romanized_title,synopsis,slug,type_id,country,original_publication_status,cover_asset_id,atualizado_em)
        VALUES ($1::text,$1::text,$1::text,$1::text,$2,'Japão','Completa',$3,NOW()) RETURNING id`,
    [`${prefix}-${suffix}`, mangaId, await createTestCover(db, prefix)]);
    return result.rows[0].id;
}

async function createEditionTypes(count) {
    const result = await db.query(`INSERT INTO domain_option_values(category_id,label,position)
        SELECT $1, $2::text || '-' || value::text, value FROM generate_series(1,$3::int) AS value RETURNING id`,
    [categoryId, `${prefix}-${optionIds.length}`, count]);
    const ids = result.rows.map(row => row.id);
    optionIds.push(...ids);
    return ids;
}

async function waitForBlockedRequests(count) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await db.query(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'`);
        if (result.rows[0].count >= count) return;
        await delay(20);
    }
    throw new Error(`As ${count} requisições não alcançaram a barreira de concorrência.`);
}

describe('regressões das classificações controladas', () => {
beforeAll(async () => {
    const user = await db.query(`INSERT INTO users(username,email,password_hash,status,nivel_acesso)
        VALUES ($1,$2,'unused','Ativada','Administrador') RETURNING id`,
    [crypto.randomUUID().slice(0, 20), `${prefix}@regression.local`]);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(`INSERT INTO sessions(user_id,session_token_hash,active_profile_id)
        SELECT $1,$2,id FROM profiles WHERE code='ADMINISTRADOR'`,
    [user.rows[0].id, crypto.createHash('sha256').update(token).digest('hex')]);
    cookie = `comanga_session=${token}`;
    mangaId = (await db.query("SELECT id FROM domain_option_values WHERE code='manga'")).rows[0].id;
    hentaiId = (await db.query("SELECT id FROM domain_option_values WHERE code='hentai'")).rows[0].id;
    categoryId = (await db.query("SELECT id FROM domain_option_categories WHERE slug='tipos-edicao'")).rows[0].id;
});

afterAll(async () => {
    await db.query('DELETE FROM works WHERE title LIKE $1', [`${prefix}%`]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${prefix}/%`]);
    await db.query('DELETE FROM users WHERE email=$1', [`${prefix}@regression.local`]);
    await db.query('DELETE FROM domain_option_values WHERE id=ANY($1::int[])', [optionIds]);
});

it('valida o país do tipo inativo preservado e não permite novas associações', async () => {
    const workId = await createWork('inactive');
    const anotherId = await createWork('another');
    const otherType = (await db.query("SELECT id FROM domain_option_values WHERE code='manhwa'")).rows[0].id;
    await db.query("UPDATE works SET type_id=$1,country='Coreia do Sul' WHERE id=$2", [otherType, anotherId]);
    await db.query('UPDATE domain_option_values SET active=false WHERE id=$1', [mangaId]);
    try {
        const kept = await request(app).patch(`/api/admin/works/${workId}`).set('Cookie', cookie)
            .send({ typeId: mangaId, country: 'Japão', synopsis: 'Revisada.' });
        expect(kept.status).toBe(200);
        const invalid = await request(app).patch(`/api/admin/works/${workId}`).set('Cookie', cookie)
            .send({ typeId: mangaId, country: 'Coreia do Sul' });
        expect(invalid.status).toBe(400);
        const persisted = await db.query('SELECT country FROM works WHERE id=$1', [workId]);
        expect(persisted.rows[0].country).toBe('Japão');
        const newLink = await request(app).patch(`/api/admin/works/${anotherId}`).set('Cookie', cookie)
            .send({ typeId: mangaId, country: 'Japão' });
        expect(newLink.status).toBe(400);
    } finally {
        await db.query('UPDATE domain_option_values SET active=true WHERE id=$1', [mangaId]);
    }
});

it('mantém a marca adulta ao adicionar Hentai e tentar desmarcá-la simultaneamente', async () => {
    const workId = await createWork('concurrent-adult');
    const blocker = await db.pool.connect();
    const requests = [];
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(9142026)');
    try {
        requests.push(request(app).patch(`/api/admin/works/${workId}`).set('Cookie', cookie)
            .send({ genreIds: [hentaiId], adultContent: false }).then(response => response.status));
        await waitForBlockedRequests(1);
        requests.push(request(app).patch(`/api/admin/works/${workId}`).set('Cookie', cookie)
            .send({ adultContent: false }).then(response => response.status));
        await waitForBlockedRequests(2);
    } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
    }
    expect(await Promise.all(requests)).toEqual([200, 200]);
    const result = await db.query(`SELECT adult_content, EXISTS(
        SELECT 1 FROM work_genres WHERE work_id=$1 AND genre_id=$2) AS has_hentai FROM works WHERE id=$1`,
    [workId, hentaiId]);
    expect(result.rows[0]).toEqual({ adult_content: true, has_hentai: true });
});

it('serializa ordens opostas sem deadlock e mantém posições contíguas', async () => {
    const ids = await createEditionTypes(2);
    const blocker = await db.pool.connect();
    const requests = [];
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM domain_option_values WHERE id=$1 FOR UPDATE', [ids[0]]);
    try {
        requests.push(request(app).patch('/api/admin/options/tipos-edicao/order').set('Cookie', cookie)
            .send({ valueIds: ids }).then(response => response.status));
        await waitForBlockedRequests(1);
        requests.push(request(app).patch('/api/admin/options/tipos-edicao/order').set('Cookie', cookie)
            .send({ valueIds: [...ids].reverse() }).then(response => response.status));
        await waitForBlockedRequests(2);
    } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
    }
    expect(await Promise.all(requests)).toEqual([200, 200]);
    const result = await db.query('SELECT id,position FROM domain_option_values WHERE category_id=$1 ORDER BY position', [categoryId]);
    expect(result.rows.slice(0, 2).map(row => row.id)).toEqual([...ids].reverse());
    expect(result.rows.map(row => row.position)).toEqual(result.rows.map((_row, index) => index));
});

it('aceita a ordem completa de uma categoria com mais de duzentos valores', async () => {
    const ids = await createEditionTypes(201);
    const response = await request(app).patch('/api/admin/options/tipos-edicao/order').set('Cookie', cookie)
        .send({ valueIds: [...ids].reverse() });
    expect(response.status).toBe(200);
    expect(response.body.values.slice(0, ids.length).map(value => value.id)).toEqual([...ids].reverse());
});

});
