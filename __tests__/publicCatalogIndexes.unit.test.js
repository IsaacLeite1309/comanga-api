const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260812150000_public_catalog_indexes',
    'migration.sql'
);
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const TEST_MIGRATION_SCRIPT_PATH = path.join(
    __dirname,
    '..',
    'scripts',
    'migrate-test-db.js'
);

const PHYSICAL_INDEXES = [
    'idx_works_title_trgm',
    'idx_works_original_title_trgm',
    'idx_domain_option_values_label_trgm',
    'idx_works_public_filters',
    'idx_works_visibility_title',
    'idx_work_authors_author_work',
    'idx_work_genres_genre_work',
    'idx_work_demographies_demography_work',
    'idx_editions_visibility_publisher',
    'idx_editions_visibility_format',
    'idx_editions_visibility_cover_type',
    'idx_volumes_calendar_release'
];

describe('indices fisicos do catalogo publico', () => {
    it('versiona pg_trgm e todos os indices exigidos em uma migration Prisma/SQL', () => {
        expect(fs.existsSync(MIGRATION_PATH)).toBe(true);

        const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');

        expect(migrationSql).toMatch(
            /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_trgm/iu
        );

        for (const indexName of PHYSICAL_INDEXES) {
            expect(migrationSql).toMatch(
                new RegExp(`CREATE\\s+INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${indexName}\\b`, 'iu')
            );
        }
    });

    it('usa GIN com trigramas para titulo, titulo original e nome de autor', () => {
        const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');

        expect(migrationSql).toMatch(
            /idx_works_title_trgm[\s\S]*?USING\s+GIN\s*\(title\s+gin_trgm_ops\)/iu
        );
        expect(migrationSql).toMatch(
            /idx_works_original_title_trgm[\s\S]*?USING\s+GIN\s*\(original_title\s+gin_trgm_ops\)/iu
        );
        expect(migrationSql).toMatch(
            /idx_domain_option_values_label_trgm[\s\S]*?USING\s+GIN\s*\(label\s+gin_trgm_ops\)/iu
        );
    });

    it('espelha no schema Prisma todos os indices representaveis', () => {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

        const schemaIndexNames = [
            'idx_works_title_trgm',
            'idx_works_original_title_trgm',
            'idx_domain_option_values_label_trgm',
            'idx_works_public_filters',
            'idx_works_visibility_title',
            'idx_work_authors_author_work',
            'idx_work_genres_genre_work',
            'idx_work_demographies_demography_work',
            'idx_editions_visibility_publisher',
            'idx_editions_visibility_format',
            'idx_editions_visibility_cover_type',
            'idx_volumes_calendar_release'
        ];

        for (const indexName of schemaIndexNames) {
            expect(schema).toContain(`map: "${indexName}"`);
        }
    });

    it('recria pg_trgm depois do reset e antes do db push do banco de teste', () => {
        const migrationScript = fs.readFileSync(TEST_MIGRATION_SCRIPT_PATH, 'utf8');
        const resetCallPosition = migrationScript.indexOf(
            'await resetTestSchemaAndEnsureExtensions()'
        );
        const dbPushPosition = migrationScript.indexOf('spawnSync(');

        expect(migrationScript).toMatch(
            /DROP\s+SCHEMA\s+IF\s+EXISTS\s+public\s+CASCADE/iu
        );
        expect(migrationScript).toMatch(
            /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_trgm/iu
        );
        expect(migrationScript).not.toContain("'--force-reset'");
        expect(resetCallPosition).toBeGreaterThan(-1);
        expect(dbPushPosition).toBeGreaterThan(resetCallPosition);
    });
});
