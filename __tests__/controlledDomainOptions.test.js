const fs = require('node:fs');
const path = require('node:path');

const { createTestCover } = require('./helpers/cover');
const db = require('../src/database');

const MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260922121000_controlled_catalog_classifications',
    'migration.sql'
);

const OFFICIAL_WORK_TYPES = {
    artbook: ['Japão'],
    databook: ['Japão'],
    'light-novel': ['Japão'],
    manga: ['Japão'],
    manhua: ['China', 'Taiwan'],
    manhwa: ['Coreia do Sul'],
    novel: ['China', 'Coreia do Sul', 'Japão', 'Taiwan']
};

const OFFICIAL_GENRES = [
    'Aventura', 'Ação', 'Boys’ Love', 'Comédia', 'Drama', 'Ecchi', 'Esportes',
    'Fantasia', 'Ficção Científica', 'Girls’ Love', 'Hentai', 'Mahou Shoujo',
    'Mecha', 'Mistério', 'Música', 'Psicológico', 'Romance', 'Slice of Life',
    'Sobrenatural', 'Suspense', 'Terror'
];

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const fixturePrefix = `controlled_${runId}`;

jest.setTimeout(30000);

function readMigrationSql() {
    return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

async function listControlledValues(categorySlug) {
    const result = await db.query(
        `SELECT value.id, value.label, value.code, value.system_managed, value.position
         FROM domain_option_values value
         JOIN domain_option_categories category ON category.id = value.category_id
         WHERE category.slug = $1
         ORDER BY value.position ASC, value.label ASC`,
        [categorySlug]
    );

    return result.rows;
}

async function listWorkTypeCountries() {
    const result = await db.query(
        `SELECT work_type.code, country.label
         FROM domain_option_value_dependencies dependency
         JOIN domain_option_values work_type ON work_type.id = dependency.dependent_value_id
         JOIN domain_option_categories type_category
             ON type_category.id = work_type.category_id AND type_category.slug = 'tipos-obra'
         JOIN domain_option_values country ON country.id = dependency.depends_on_value_id
         ORDER BY work_type.code, country.label`
    );

    return result.rows.reduce((grouped, row) => ({
        ...grouped,
        [row.code]: [...(grouped[row.code] || []), row.label]
    }), {});
}

async function deleteFixtures() {
    await db.query('DELETE FROM works WHERE title LIKE $1', [`${fixturePrefix}%`]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${fixturePrefix}/%`]);
    await db.query('DELETE FROM domain_option_values WHERE label LIKE $1', [`${fixturePrefix}%`]);
}

describe('semeadura idempotente dos valores controlados', () => {
    beforeEach(deleteFixtures);
    afterEach(deleteFixtures);

    it.each([
        ['tipos-obra', 'manga', 'Manga', 'Mangá'],
        ['generos', 'acao', 'Acao', 'Ação'],
        ['generos', 'boys-love', "Boys' Love", 'Boys’ Love'],
        ['tipos-obra', 'manga', 'Manga', 'mANGá']
    ])('preserva nomes equivalentes e vínculos legados em %s: %s', async (category, code, alias, exactLabel) => {
        const client = await db.pool.connect();
        await client.query('BEGIN');
        try {
            // Simula a base anterior: ainda não há identidade oficial, e o alias é mais antigo.
            const original = (await client.query(`SELECT value.id, value.category_id
                FROM domain_option_values value JOIN domain_option_categories category ON category.id=value.category_id
                WHERE category.slug=$1 AND value.code=$2`, [category, code])).rows[0];
            await client.query(`UPDATE domain_option_values SET label=$1, code=NULL, system_managed=FALSE WHERE id=$2`,
                [alias, original.id]);
            const canonical = (await client.query(`INSERT INTO domain_option_values(category_id,label,active)
                VALUES ($1,$2,FALSE) RETURNING id`, [original.category_id, exactLabel])).rows[0];
            const mangaId = category === 'tipos-obra' ? original.id
                : (await client.query("SELECT id FROM domain_option_values WHERE code='manga'")).rows[0].id;
            const work = (await client.query(`INSERT INTO works
                (cover_asset_id,slug,title,romanized_title,synopsis,type_id,country,original_publication_status,atualizado_em)
                VALUES ($1,$2::text,$2::text,$2::text,$2::text,$3,'Japão','Completa',NOW()) RETURNING id`,
                [await createTestCover(client, fixturePrefix), `${fixturePrefix}-equivalentes`, mangaId])).rows[0];
            if (category === 'generos') {
                await client.query('INSERT INTO work_genres(work_id,genre_id) VALUES ($1,$2)', [work.id, original.id]);
            }

            await client.query(readMigrationSql());
            await client.query(readMigrationSql());

            const values = (await client.query(`SELECT id,label,code,system_managed,active
                FROM domain_option_values WHERE id=ANY($1::int[]) ORDER BY id`, [[original.id, canonical.id]])).rows;
            expect(values).toEqual([
                { id: original.id, label: alias, code: null, system_managed: false, active: true },
                { id: canonical.id, label: code === 'manga' ? 'Mangá' : code === 'acao' ? 'Ação' : 'Boys’ Love',
                    code, system_managed: true, active: false }
            ]);
            const linked = category === 'tipos-obra'
                ? await client.query('SELECT type_id AS id FROM works WHERE id=$1', [work.id])
                : await client.query('SELECT genre_id AS id FROM work_genres WHERE work_id=$1', [work.id]);
            expect(linked.rows).toEqual([{ id: original.id }]);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it('mantém os 7 tipos e os 21 gêneros oficiais com código, controle e ordem', async () => {
        const workTypes = await listControlledValues('tipos-obra');
        const genres = await listControlledValues('generos');
        const officialTypes = workTypes.filter((value) => value.system_managed);
        const officialGenres = genres.filter((value) => value.system_managed);

        expect(officialTypes.map((value) => value.code).sort()).toEqual(
            Object.keys(OFFICIAL_WORK_TYPES).sort()
        );
        expect(officialTypes.map((value) => value.code)).toEqual(['manga', 'manhwa', 'manhua', 'light-novel', 'novel', 'artbook', 'databook']);
        expect(officialGenres.map((value) => value.label)).toEqual(OFFICIAL_GENRES);
        expect(officialGenres.map((value) => value.position)).toEqual(
            OFFICIAL_GENRES.map((_label, index) => index)
        );
        expect(await listWorkTypeCountries()).toEqual(OFFICIAL_WORK_TYPES);
    });

    it('reexecutar o seed não duplica valores, não troca ids e preserva associações', async () => {
        const typesBefore = await listControlledValues('tipos-obra');
        const genresBefore = await listControlledValues('generos');
        const manga = typesBefore.find((value) => value.code === 'manga');
        const hentai = genresBefore.find((value) => value.code === 'hentai');
        const coverAssetId = await createTestCover(db, fixturePrefix);
        const work = await db.query(
            `INSERT INTO works (cover_asset_id, slug, title, romanized_title, synopsis, type_id, country,
                original_publication_status, visibility, adult_content, atualizado_em)
             VALUES ($1, $2, $3::text, $3::text, $3::text, $4, 'Japão', 'Completa', 'Privado', TRUE, NOW())
             RETURNING id`,
            [coverAssetId, `${fixturePrefix}-obra`, `${fixturePrefix} Obra`, manga.id]
        );
        await db.query(
            'INSERT INTO work_genres (work_id, genre_id) VALUES ($1, $2)',
            [work.rows[0].id, hentai.id]
        );

        await db.query(readMigrationSql());
        await db.query(readMigrationSql());

        expect(await listControlledValues('tipos-obra')).toEqual(typesBefore);
        expect(await listControlledValues('generos')).toEqual(genresBefore);
        expect(await listWorkTypeCountries()).toEqual(OFFICIAL_WORK_TYPES);
        const association = await db.query(
            'SELECT genre_id FROM work_genres WHERE work_id = $1',
            [work.rows[0].id]
        );
        expect(association.rows.map((row) => row.genre_id)).toEqual([hentai.id]);
        const stillThere = await db.query('SELECT type_id FROM works WHERE id = $1', [work.rows[0].id]);
        expect(stillThere.rows[0].type_id).toBe(manga.id);
    });

    it('não apaga valores antigos sem correspondência e não os marca como do sistema', async () => {
        const category = await db.query(
            "SELECT id FROM domain_option_categories WHERE slug = 'generos'"
        );
        const legacy = await db.query(
            'INSERT INTO domain_option_values (category_id, label) VALUES ($1, $2) RETURNING id',
            [category.rows[0].id, `${fixturePrefix} Genero Legado`]
        );

        await db.query(readMigrationSql());

        const survivor = await db.query(
            'SELECT id, system_managed, code, active FROM domain_option_values WHERE id = $1',
            [legacy.rows[0].id]
        );
        expect(survivor.rows).toHaveLength(1);
        expect(survivor.rows[0]).toEqual(expect.objectContaining({
            system_managed: false,
            code: null,
            active: true
        }));
    });

    it('normaliza adult_content das Obras já associadas a Hentai', async () => {
        const hentai = (await listControlledValues('generos')).find((value) => value.code === 'hentai');
        const manga = (await listControlledValues('tipos-obra')).find((value) => value.code === 'manga');
        const coverAssetId = await createTestCover(db, fixturePrefix);
        const work = await db.query(
            `INSERT INTO works (cover_asset_id, slug, title, romanized_title, synopsis, type_id, country,
                original_publication_status, visibility, adult_content, atualizado_em)
             VALUES ($1, $2, $3::text, $3::text, $3::text, $4, 'Japão', 'Completa', 'Público', FALSE, NOW())
             RETURNING id`,
            [coverAssetId, `${fixturePrefix}-legada`, `${fixturePrefix} Legada`, manga.id]
        );
        await db.query(
            'INSERT INTO work_genres (work_id, genre_id) VALUES ($1, $2)',
            [work.rows[0].id, hentai.id]
        );

        await db.query(readMigrationSql());

        const normalized = await db.query('SELECT adult_content FROM works WHERE id = $1', [work.rows[0].id]);
        expect(normalized.rows[0].adult_content).toBe(true);
    });

    it('versiona a semeadura de forma reexecutável e sem exclusões destrutivas', () => {
        const sql = readMigrationSql();

        expect(sql).toContain('ADD COLUMN IF NOT EXISTS code');
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS system_managed');
        expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_option_values_category_code');
        expect(sql).not.toMatch(/DELETE\s+FROM\s+domain_option_values/i);
        expect(sql).not.toMatch(/DELETE\s+FROM\s+work_genres/i);
        expect(sql).not.toMatch(/DROP\s+TABLE/i);
    });
});
