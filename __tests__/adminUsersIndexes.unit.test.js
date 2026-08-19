const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260630190000_admin_users_indexes',
    'migration.sql'
);
const TEST_MIGRATION_SCRIPT_PATH = path.join(
    __dirname,
    '..',
    'scripts',
    'migrate-test-db.js'
);

describe('indices fisicos da administracao de usuarios', () => {
    it('versiona pg_trgm, os indices GIN de busca parcial e o B-Tree de ordenacao', () => {
        const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');

        expect(migrationSql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_trgm/iu);
        expect(migrationSql).toMatch(
            /idx_users_username_trgm[\s\S]*?USING\s+GIN\s*\(username\s+gin_trgm_ops\)/iu
        );
        expect(migrationSql).toMatch(
            /idx_users_email_trgm[\s\S]*?USING\s+GIN\s*\(email\s+gin_trgm_ops\)/iu
        );
        expect(migrationSql).toMatch(
            /idx_users_username_sort[\s\S]*?ON\s+users\s*\(username\)/iu
        );
    });

    it('aplica a migration de indices administrativos ao reconstruir o banco de teste', () => {
        const migrationScript = fs.readFileSync(TEST_MIGRATION_SCRIPT_PATH, 'utf8');

        expect(migrationScript).toContain('ADMIN_USERS_INDEXES_MIGRATION_PATH');
        expect(migrationScript).toContain('20260630190000_admin_users_indexes');
        expect(migrationScript).toMatch(
            /for\s*\(const\s+migrationPath\s+of\s*\[[\s\S]*?ADMIN_USERS_INDEXES_MIGRATION_PATH/iu
        );
    });
});
