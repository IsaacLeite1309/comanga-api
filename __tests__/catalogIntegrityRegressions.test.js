process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database');
const { createTestCover } = require('./helpers/cover');
const prefix = `integrity_${crypto.randomUUID()}`;
let cookie, userId, publisher, work, edition, volume;

async function waitForBlocked(count) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await db.query(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'`);
        if (result.rows[0].count >= count) return;
        await delay(20);
    }
    throw new Error('Requisições não alcançaram a barreira de concorrência.');
}

async function concurrent(first, second) {
    const blocker = await db.pool.connect();
    const calls = [];
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(9142026)');
    try {
        calls.push(first().then(r => r.status));
        await waitForBlocked(1);
        calls.push(second().then(r => r.status));
        await waitForBlocked(2);
    } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
    }
    return Promise.all(calls);
}

function patchVolume(body) {
    return request(app).patch(`/api/admin/volumes/${volume}`).set('Cookie', cookie).send(body);
}
function workVisibility(visibility) {
    return request(app).patch(`/api/admin/works/${work}/visibility`).set('Cookie', cookie).send({ visibility });
}
function editionVisibility(visibility) {
    return request(app).patch(`/api/admin/editions/${edition}/visibility`).set('Cookie', cookie).send({ visibility });
}
async function savedVolume() {
    return (await db.query(`SELECT pages,price,price_currency,single_volume,release_date_precision,release_year,
        release_month,release_day,synopsis FROM volumes WHERE id=$1`, [volume])).rows[0];
}

describe('integridade de Volumes e publicação concorrente', () => {
    beforeAll(async () => {
        userId = (await db.query(`INSERT INTO users(username,email,password_hash,status,nivel_acesso)
            VALUES($1,$2,'unused','Ativada','Administrador') RETURNING id`,
        [crypto.randomUUID().slice(0, 20), `${prefix}@test.local`])).rows[0].id;
        const token = crypto.randomBytes(32).toString('hex');
        await db.query(`INSERT INTO sessions(user_id,session_token_hash,active_profile_id)
            SELECT $1,$2,id FROM profiles WHERE code='ADMINISTRADOR'`,
        [userId, crypto.createHash('sha256').update(token).digest('hex')]);
        cookie = `comanga_session=${token}`;
        publisher = (await db.query(`INSERT INTO domain_option_values(category_id,label)
            SELECT id,$1 FROM domain_option_categories WHERE slug='editoras-brasileiras' RETURNING id`, [prefix])).rows[0].id;
    });

    beforeEach(async () => {
        const type = (await db.query("SELECT id FROM domain_option_values WHERE code='manga'")).rows[0].id;
        work = (await db.query(`INSERT INTO works(cover_asset_id,slug,title,romanized_title,synopsis,type_id,country,
            original_publication_status,visibility,atualizado_em)
            VALUES($1,$2::text,$2::text,$2::text,$2::text,$3,'Japão','Completa','Público',NOW()) RETURNING id`,
        [await createTestCover(db, prefix), `${prefix}-${crypto.randomUUID()}`, type])).rows[0].id;
        edition = (await db.query(`INSERT INTO editions(work_id,brazilian_publisher_id,chronological_number,
            brazil_publication_status,visibility,atualizado_em) VALUES($1,$2,1,'Completa','Privado',NOW()) RETURNING id`,
        [work, publisher])).rows[0].id;
        volume = (await db.query(`INSERT INTO volumes(edition_id,number,cover_asset_id,pages,price,price_currency,
            single_volume,release_date_precision,release_year,release_month,release_day,atualizado_em)
            VALUES($1,1,$2,192,29.90,'Cr$',TRUE,'Completa',2024,1,31,NOW()) RETURNING id`,
        [edition, await createTestCover(db, prefix)])).rows[0].id;
    });

    afterEach(async () => {
        await db.query('DELETE FROM volumes WHERE edition_id=$1', [edition]);
        await db.query('DELETE FROM editions WHERE id=$1', [edition]);
        await db.query('DELETE FROM works WHERE id=$1', [work]);
    });
    afterAll(async () => {
        await db.query('DELETE FROM domain_option_values WHERE id=$1', [publisher]);
        await db.query('DELETE FROM users WHERE id=$1', [userId]);
        await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${prefix}/%`]);
    });

    it('preserva campos omitidos ao alterar só a sinopse', async () => {
        const before = await savedVolume();
        expect((await patchVolume({ synopsis: 'Nova sinopse' })).status).toBe(200);
        expect(await savedVolume()).toEqual({ ...before, synopsis: 'Nova sinopse' });
    });

    it('aceita limpeza explícita, zero, false e mudança de moeda sem defaults do cadastro', async () => {
        expect((await patchVolume({ pages: null, price: 0, singleVolume: false, priceCurrency: 'NCz$', synopsis: null })).status).toBe(200);
        expect(await savedVolume()).toEqual(expect.objectContaining({ pages: null, price: '0.00', single_volume: false, price_currency: 'NCz$', synopsis: null }));
        expect((await patchVolume({ price: null })).status).toBe(200);
        expect(await savedVolume()).toEqual(expect.objectContaining({ price: null, price_currency: 'NCz$' }));
    });

    it('recusa PATCH vazio sem alterar o registro', async () => {
        const before = await savedVolume();
        expect((await patchVolume({})).status).toBe(400);
        expect(await savedVolume()).toEqual(before);
    });

    it.each([{ releaseMonth: 2 }, { releaseDay: null }, { releaseMonth: null }, { releaseYear: null }])(
        'recusa data final inválida em PATCH %j e preserva todos os campos', async payload => {
            const before = await savedVolume();
            expect((await patchVolume(payload)).status).toBe(400);
            expect(await savedVolume()).toEqual(before);
        }
    );

    it('recusa ano não bissexto ao atualizar só o ano de 29/02', async () => {
        await db.query('UPDATE volumes SET release_month=2,release_day=29 WHERE id=$1', [volume]);
        const before = await savedVolume();
        expect((await patchVolume({ releaseYear: 2023 })).status).toBe(400);
        expect(await savedVolume()).toEqual(before);
    });

    it.each([
        [{ releaseMonth: 3 }, { release_month: 3 }],
        [{ releaseDay: 30 }, { release_day: 30 }],
        [{ releaseYear: 2025 }, { release_year: 2025 }],
        [{ releaseDatePrecision: 'Mes e ano' }, { release_date_precision: 'Mes e ano', release_day: null }],
        [{ releaseDatePrecision: 'Ano' }, { release_date_precision: 'Ano', release_month: null, release_day: null }],
        [{ releaseDatePrecision: 'Completa' }, {}]
    ])('combina PATCH válido %j com a data persistida', async (payload, changes) => {
        const before = await savedVolume();
        expect((await patchVolume(payload)).status).toBe(200);
        expect(await savedVolume()).toEqual({ ...before, ...changes });
    });

    it('exige os componentes faltantes ao aumentar a precisão', async () => {
        await db.query("UPDATE volumes SET release_date_precision='Ano',release_month=NULL,release_day=NULL WHERE id=$1", [volume]);
        expect((await patchVolume({ releaseDatePrecision: 'Completa' })).status).toBe(400);
        expect((await patchVolume({ releaseDatePrecision: 'Completa', releaseMonth: 2, releaseDay: 29 })).status).toBe(200);
        expect(await savedVolume()).toEqual(expect.objectContaining({ release_year: 2024, release_month: 2, release_day: 29 }));
    });

    it('revalida a data sob o lock em duas alterações individualmente válidas', async () => {
        await db.query('UPDATE volumes SET release_month=1,release_day=28 WHERE id=$1', [volume]);
        const statuses = await concurrent(() => patchVolume({ releaseDay: 31 }), () => patchVolume({ releaseMonth: 2 }));
        expect(statuses).toEqual([200, 400]);
        expect(await savedVolume()).toEqual(expect.objectContaining({ release_month: 1, release_day: 31, pages: 192, price: '29.90' }));
    });

    it.each([false, true])('serializa publicação de Edição e rebaixamento da Obra (publicação primeiro: %s)', async publishFirst => {
        const statuses = publishFirst
            ? await concurrent(() => editionVisibility('Público'), () => workVisibility('Privado'))
            : await concurrent(() => workVisibility('Privado'), () => editionVisibility('Público'));
        expect(statuses).toEqual([200, 409]);
        const stored = (await db.query(`SELECT w.visibility AS work,e.visibility AS edition,v.visibility AS volume
            FROM works w JOIN editions e ON e.work_id=w.id JOIN volumes v ON v.edition_id=e.id WHERE w.id=$1`, [work])).rows[0];
        expect(stored).toEqual(publishFirst
            ? { work: 'Público', edition: 'Público', volume: 'Público' }
            : { work: 'Privado', edition: 'Privado', volume: 'Privado' });
    });
});
