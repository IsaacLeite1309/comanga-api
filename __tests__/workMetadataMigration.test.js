const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/database');
const { createTestCover } = require('./helpers/cover');

const migrationSql = fs.readFileSync(path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260920121000_work_metadata_and_author_positions',
    'migration.sql'
), 'utf8');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const fixturePrefix = `work_metadata_${runId}`;

async function createOption(client, categorySlug, suffix) {
    const category = await client.query(
        `INSERT INTO domain_option_categories (slug, name)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = domain_option_categories.name
         RETURNING id`,
        [categorySlug, `Categoria ${categorySlug}`]
    );
    const option = await client.query(
        `INSERT INTO domain_option_values (category_id, label)
         VALUES ($1, $2)
         RETURNING id`,
        [category.rows[0].id, `${fixturePrefix}_${suffix}`]
    );

    return option.rows[0].id;
}

async function createLegacyWork(client, typeId, suffix) {
    const title = `${fixturePrefix}_${suffix}`;
    const result = await client.query(
        `INSERT INTO works (
            cover_asset_id, slug, title, romanized_title, synopsis,
            type_id, country, original_publication_status, atualizado_em
         ) VALUES ($1, $2, $3, $4, $5, $6, 'Japão', 'Completa', NOW())
         RETURNING id`,
        [
            await createTestCover(client, fixturePrefix),
            `${fixturePrefix}-${suffix}`.toLowerCase().replace(/_/g, '-'),
            title,
            title,
            title,
            typeId
        ]
    );

    return result.rows[0].id;
}

describe('migration dos metadados da Obra e da ordem dos Autores', () => {
    it('exige título romanizado e sinopse depois de aplicada', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            const typeId = await createOption(client, 'tipos-obra', 'type');
            const coverAssetId = await createTestCover(client, fixturePrefix);

            await expect(client.query(
                `INSERT INTO works (
                    cover_asset_id, slug, title, type_id, country,
                    original_publication_status, atualizado_em
                 ) VALUES ($1, $2, $3, $4, 'Japão', 'Completa', NOW())`,
                [coverAssetId, `${fixturePrefix}-sem-metadados`, `${fixturePrefix}_sem_metadados`, typeId]
            )).rejects.toMatchObject({ code: '23502' });
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it('preenche os metadados ausentes com o título antes de tornar as colunas obrigatórias', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            const typeId = await createOption(client, 'tipos-obra', 'backfill-type');
            const workId = await createLegacyWork(client, typeId, 'backfill');

            // Reproduz o estado anterior à migration para a Obra existente.
            await client.query('ALTER TABLE works ALTER COLUMN romanized_title DROP NOT NULL');
            await client.query('ALTER TABLE works ALTER COLUMN synopsis DROP NOT NULL');
            await client.query(
                'UPDATE works SET romanized_title = NULL, synopsis = NULL WHERE id = $1',
                [workId]
            );

            await client.query(migrationSql);

            const migrated = await client.query(
                'SELECT title, romanized_title, synopsis FROM works WHERE id = $1',
                [workId]
            );
            const columns = await client.query(`
                SELECT column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'works'
                  AND column_name IN ('romanized_title', 'synopsis')
                ORDER BY column_name
            `);

            expect(migrated.rows[0].romanized_title).toBe(migrated.rows[0].title);
            expect(migrated.rows[0].synopsis).toBe(migrated.rows[0].title);
            expect(columns.rows).toEqual([
                { column_name: 'romanized_title', is_nullable: 'NO' },
                { column_name: 'synopsis', is_nullable: 'NO' }
            ]);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it('distribui posições contíguas por ordem alfabética do Autor dentro da Obra', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            const typeId = await createOption(client, 'tipos-obra', 'authors-type');
            const workId = await createLegacyWork(client, typeId, 'authors');
            const zuluId = await createOption(client, 'autores', 'zulu');
            const alfaId = await createOption(client, 'autores', 'alfa');

            // Vínculos legados nascem todos na posição padrão 0.
            await client.query(
                `INSERT INTO work_authors (work_id, author_id, position)
                 VALUES ($1, $2, 0), ($1, $3, 0)`,
                [workId, zuluId, alfaId]
            );

            await client.query(migrationSql);

            const backfilled = await client.query(
                `SELECT author_id, position FROM work_authors
                 WHERE work_id = $1 ORDER BY position`,
                [workId]
            );

            expect(backfilled.rows).toEqual([
                { author_id: alfaId, position: 0 },
                { author_id: zuluId, position: 1 }
            ]);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it('não descarta uma ordem editorial já definida ao reaplicar o backfill', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            const typeId = await createOption(client, 'tipos-obra', 'ordered-type');
            const workId = await createLegacyWork(client, typeId, 'ordered');
            const zuluId = await createOption(client, 'autores', 'ordered-zulu');
            const alfaId = await createOption(client, 'autores', 'ordered-alfa');

            await client.query(
                `INSERT INTO work_authors (work_id, author_id, position)
                 VALUES ($1, $2, 0), ($1, $3, 1)`,
                [workId, zuluId, alfaId]
            );

            await client.query(migrationSql);

            const preserved = await client.query(
                `SELECT author_id, position FROM work_authors
                 WHERE work_id = $1 ORDER BY position`,
                [workId]
            );

            expect(preserved.rows).toEqual([
                { author_id: zuluId, position: 0 },
                { author_id: alfaId, position: 1 }
            ]);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it('mantém o índice físico da ordem editorial dos Autores', async () => {
        const result = await db.query(`
            SELECT indexdef FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'idx_work_authors_position'
        `);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].indexdef).toContain('work_id');
        expect(result.rows[0].indexdef).toContain('position');
    });
});
