const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/database');

describe('historico real de migrations', () => {
    it('aplica todos os arquivos versionados, sem substituir o historico por db push', async () => {
        const migrations = fs.readdirSync(path.join(__dirname, '../prisma/migrations'))
            .filter((name) => /^\d/.test(name)).sort();
        const result = await db.query(`
            SELECT migration_name FROM _prisma_migrations
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            ORDER BY migration_name
        `);
        expect(result.rows.map((row) => row.migration_name)).toEqual(migrations);
    });

    it('mantem os indices de busca criados pelas migrations', async () => {
        const result = await db.query(`
            SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        `);
        expect(result.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
            'idx_users_username_trgm', 'idx_users_email_trgm', 'idx_users_username_sort',
            'idx_works_title_trgm', 'idx_domain_option_values_label_trgm'
        ]));
    });
});
