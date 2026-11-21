const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../../src/database');
const { createTestCover } = require('../helpers/cover');
const { legacyCountrySchema } = require('../helpers/legacyCountrySchema');
const migration = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261121120000_remove_country_and_retired_work_types/migration.sql'), 'utf8');

async function oldType(client, code) {
    return (await client.query(`INSERT INTO domain_option_values(category_id,label,code,system_managed)
        SELECT id,$1,$1,TRUE FROM domain_option_categories WHERE slug='tipos-obra' RETURNING id`, [code])).rows[0].id;
}

async function createWork(client, typeId) {
    const label = `country_migration_${crypto.randomUUID()}`;
    return (await client.query(`INSERT INTO works(slug,title,romanized_title,synopsis,type_id,country,original_publication_status,cover_asset_id)
        VALUES($1::text,$1::text,$1::text,$1::text,$2,'Coreia do Sul','Completa',$3) RETURNING id`,
    [label, typeId, await createTestCover(client, label)])).rows[0].id;
}

async function createLinkedCatalog(client, typeId) {
    const workId = await createWork(client, typeId);
    const prefix = `migration_links_${crypto.randomUUID()}`;
    const options = {};
    for (const slug of ['autores', 'editoras-originais', 'revistas-serializacao', 'editoras-brasileiras']) {
        options[slug] = (await client.query(`INSERT INTO domain_option_values(category_id,label)
            SELECT id,$2 FROM domain_option_categories WHERE slug=$1 RETURNING id`, [slug, prefix])).rows[0].id;
    }
    await client.query('INSERT INTO work_authors(work_id,author_id) VALUES($1,$2)', [workId, options.autores]);
    await client.query("INSERT INTO work_author_roles(work_id,author_id,role) VALUES($1,$2,'História e Arte')", [workId, options.autores]);
    await client.query('INSERT INTO work_original_publishers(work_id,publisher_id) VALUES($1,$2)', [workId, options['editoras-originais']]);
    await client.query('INSERT INTO work_serialization_magazines(work_id,magazine_id) VALUES($1,$2)', [workId, options['revistas-serializacao']]);
    const editionId = (await client.query(`INSERT INTO editions(work_id,brazilian_publisher_id,chronological_number,brazil_publication_status)
        VALUES($1,$2,1,'Em andamento') RETURNING id`, [workId, options['editoras-brasileiras']])).rows[0].id;
    const userId = crypto.randomUUID();
    await client.query(`INSERT INTO users(id,username,email,password_hash,status,birth_date)
        VALUES($1,$2,$3,'hash','Ativada','1990-01-01')`, [userId, prefix.slice(0,50), `${prefix}@migration.invalid`]);
    for (const [index, state] of ['Owned', 'Wanted'].entries()) {
        const coverId = await createTestCover(client, `${prefix}_${index}`);
        const volumeId = (await client.query('INSERT INTO volumes(edition_id,number,cover_asset_id,release_year,release_month,release_day) VALUES($1,$2,$3,2026,11,21) RETURNING id', [editionId, index + 1, coverId])).rows[0].id;
        await client.query('INSERT INTO user_volumes(user_id,volume_id,state,read) VALUES($1,$2,$3,$4)', [userId, volumeId, state, state === 'Owned' ? true : null]);
    }
}

// Compara todas as tabelas do banco, inclusive relações, usuários e catálogos pessoais.
async function snapshot(client, removedIds, countryCategoryId) {
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const data = {};
    for (const { tablename } of tables) {
        if (['_prisma_migrations', 'domain_option_value_dependencies'].includes(tablename)) continue;
        const rows = (await client.query(`SELECT to_jsonb(row) AS data FROM "${tablename.replaceAll('"', '""')}" row`)).rows.map(row => row.data);
        data[tablename] = rows.filter(row => !(tablename === 'domain_option_values' && (removedIds.includes(row.id) || row.category_id === countryCategoryId))
            && !(tablename === 'domain_option_categories' && row.id === countryCategoryId))
            .map(row => { if (tablename === 'works') delete row.country; return JSON.stringify(row); }).sort();
    }
    return data;
}

async function expectStructureRemoved(client) {
    expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='works' AND column_name='country'")).rows).toEqual([]);
    expect((await client.query("SELECT to_regclass('domain_option_value_dependencies') AS dependencies, to_regclass('idx_works_country') AS country_index")).rows).toEqual([{ dependencies: null, country_index: null }]);
    expect((await client.query("SELECT id FROM domain_option_categories WHERE slug='paises-origem'")).rows).toEqual([]);
    expect((await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_works_public_filters'")).rows[0].indexdef).toMatch(/\(visibility, adult_content, type_id, id\)/);
}

it('remove a estrutura de país e os tipos sem uso, preserva o restante do banco e permite reaplicação', async () => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(legacyCountrySchema);
        const retiredIds = [await oldType(client, 'manhwa'), await oldType(client, 'manhua')];
        const manga = (await client.query("SELECT id FROM domain_option_values WHERE code='manga'")).rows[0].id;
        await createLinkedCatalog(client, manga);
        const country = (await client.query(`SELECT value.id,value.category_id FROM domain_option_values value JOIN domain_option_categories category ON category.id=value.category_id WHERE category.slug='paises-origem' LIMIT 1`)).rows[0];
        const dependents = (await client.query(`SELECT value.id FROM domain_option_values value JOIN domain_option_categories category ON category.id=value.category_id WHERE category.slug IN ('autores','editoras-originais','revistas-serializacao','tipos-obra')`)).rows;
        for (const { id } of dependents) await client.query('INSERT INTO domain_option_value_dependencies VALUES($1,$2) ON CONFLICT DO NOTHING', [id, country.id]);
        const before = await snapshot(client, retiredIds, country.category_id);
        await client.query(migration);
        await client.query(migration);
        expect(await snapshot(client, retiredIds, country.category_id)).toEqual(before);
        await expectStructureRemoved(client);
        const label = `new_work_${crypto.randomUUID()}`;
        const created = await client.query(`INSERT INTO works(slug,title,romanized_title,synopsis,type_id,original_publication_status,cover_asset_id)
            VALUES($1::text,$1::text,$1::text,$1::text,$2,'Completa',$3) RETURNING *`, [label, manga, await createTestCover(client, label)]);
        expect(created.rows[0]).not.toHaveProperty('country');
    } finally { await client.query('ROLLBACK'); client.release(); }
});

it('interrompe atomicamente se houver obra usando Manhwa/Manhua', async () => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(legacyCountrySchema);
        const typeId = await oldType(client, 'manhwa');
        const workId = await createWork(client, typeId);
        await client.query('SAVEPOINT before_migration');
        await expect(client.query(migration)).rejects.toMatchObject({ code: 'P0001' });
        await client.query('ROLLBACK TO SAVEPOINT before_migration');
        expect((await client.query('SELECT type_id,country FROM works WHERE id=$1', [workId])).rows).toEqual([{ type_id: typeId, country: 'Coreia do Sul' }]);
        expect((await client.query('SELECT id FROM domain_option_values WHERE id=$1', [typeId])).rows).toHaveLength(1);
    } finally { await client.query('ROLLBACK'); client.release(); }
});

it('recusa excluir a tabela se ela tiver vínculos que não sejam de país', async () => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(legacyCountrySchema);
        const values = (await client.query("SELECT id FROM domain_option_values WHERE code IN ('manga','novel') ORDER BY id")).rows;
        await client.query('INSERT INTO domain_option_value_dependencies VALUES($1,$2)', [values[0].id, values[1].id]);
        await client.query('SAVEPOINT before_migration');
        await expect(client.query(migration)).rejects.toMatchObject({ code: 'P0001' });
        await client.query('ROLLBACK TO SAVEPOINT before_migration');
        expect((await client.query('SELECT * FROM domain_option_value_dependencies WHERE dependent_value_id=$1', [values[0].id])).rows).toHaveLength(1);
    } finally { await client.query('ROLLBACK'); client.release(); }
});

it('não usa exclusão em cascata e reverte alterações se outro objeto depender da coluna', async () => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(legacyCountrySchema);
        await client.query('CREATE VIEW country_migration_guard AS SELECT country FROM works');
        await client.query('SAVEPOINT before_migration');
        await expect(client.query(migration)).rejects.toMatchObject({ code: '2BP01' });
        await client.query('ROLLBACK TO SAVEPOINT before_migration');
        expect((await client.query("SELECT id FROM domain_option_categories WHERE slug='paises-origem'")).rows).toHaveLength(1);
        expect((await client.query("SELECT to_regclass('domain_option_value_dependencies') AS dependencies")).rows[0].dependencies).not.toBeNull();
    } finally { await client.query('ROLLBACK'); client.release(); }
});
