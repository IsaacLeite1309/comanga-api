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

async function createWork(suffix) {
    const result = await db.query(`INSERT INTO works
        (title,romanized_title,synopsis,slug,type_id,country,original_publication_status,cover_asset_id,atualizado_em)
        VALUES ($1::text,$1::text,$1::text,$1::text,$2,'Japão','Completa',$3,NOW()) RETURNING id`,
    [`${prefix}-${suffix}`, mangaId, await createTestCover(db, prefix)]);
    return result.rows[0].id;
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
});

afterAll(async () => {
    await db.query('DELETE FROM works WHERE title LIKE $1', [`${prefix}%`]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${prefix}/%`]);
    await db.query('DELETE FROM users WHERE email=$1', [`${prefix}@regression.local`]);
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

it('revalida tipo e país após aguardar outra atualização da mesma Obra', async () => {
    const workId = await createWork('concurrent-country');
    const novelId = (await db.query("SELECT id FROM domain_option_values WHERE code='novel'")).rows[0].id;
    await db.query('UPDATE works SET type_id=$1 WHERE id=$2', [novelId, workId]);
    const blocker = await db.pool.connect();
    const requests = [];
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(9142026)');
    try {
        requests.push(request(app).patch(`/api/admin/works/${workId}`).set('Cookie', cookie)
            .send({ country: 'China' }).then(response => response.status));
        await waitForBlockedRequests(1);
        requests.push(request(app).patch(`/api/admin/works/${workId}`).set('Cookie', cookie)
            .send({ typeId: mangaId }).then(response => response.status));
        await waitForBlockedRequests(2);
    } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
    }
    expect(await Promise.all(requests)).toEqual([200, 400]);
    const stored = await db.query('SELECT type_id,country FROM works WHERE id=$1', [workId]);
    expect(stored.rows[0]).toEqual({ type_id: novelId, country: 'China' });
});

});
