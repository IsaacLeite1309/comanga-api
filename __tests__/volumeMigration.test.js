const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/database');

const migrationSql = fs.readFileSync(path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260818120000_enforce_volume_release_date',
    'migration.sql'
), 'utf8');

describe('migration da data de publicação de Volumes', () => {
    it('aplica a regra nova sem exigir reescrita dos registros legados', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(migrationSql);

            const defaultResult = await client.query(`
                SELECT column_default
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'volumes'
                  AND column_name = 'release_date_precision'
            `);
            const constraintResult = await client.query(`
                SELECT convalidated, pg_get_constraintdef(oid) AS definition
                FROM pg_constraint
                WHERE conname = 'volumes_release_precision_check'
            `);

            expect(defaultResult.rows[0].column_default).toContain('Completa');
            expect(constraintResult.rows[0]).toEqual(expect.objectContaining({
                convalidated: false,
                definition: expect.stringContaining("'Mes e ano'")
            }));
            expect(constraintResult.rows[0].definition).not.toContain('Desconhecida');
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});
