const crypto = require('node:crypto');
const db = require('../../src/database');
const { createTestCover } = require('../helpers/cover');

it('permite o mesmo título para mangá e light novel, mas recusa duas obras do mesmo tipo', async () => {
    const client = await db.pool.connect();
    const prefix = `title_type_${crypto.randomUUID()}`;
    const title = `${prefix}_Música`;

    async function insertWork(typeId, slug, workTitle = title) {
        return client.query(`INSERT INTO works (
            cover_asset_id, slug, title, romanized_title, synopsis,
            type_id, country, original_publication_status, atualizado_em
        ) VALUES ($1, $2, $3, $3, 'Sinopse de teste.', $4, 'Japão', 'Completa', NOW())`, [
            await createTestCover(client, prefix), slug, workTitle, typeId
        ]);
    }

    try {
        await client.query('BEGIN');
        const types = await client.query("SELECT code, id FROM domain_option_values WHERE code IN ('manga', 'light-novel')");
        const mangaId = types.rows.find(({ code }) => code === 'manga').id;
        const lightNovelId = types.rows.find(({ code }) => code === 'light-novel').id;

        await insertWork(mangaId, `${prefix}-manga`);
        await insertWork(lightNovelId, `${prefix}-light-novel`);

        await client.query('SAVEPOINT duplicate_title');
        await expect(insertWork(mangaId, `${prefix}-manga-2`, title.toUpperCase()))
            .rejects.toMatchObject({ code: '23505', constraint: 'works_title_type_unique' });
        await client.query('ROLLBACK TO SAVEPOINT duplicate_title');
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
});
