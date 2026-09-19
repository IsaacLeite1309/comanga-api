const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260911193000_add_public_catalog_filter_indexes',
    'migration.sql'
);
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');

const INDEXES = [
    'idx_works_visibility_original_status',
    'idx_editions_visibility_chronological',
    'idx_editions_visibility_publication_status'
];

describe('índices dos filtros adicionais do catálogo público', () => {
    it('versiona os índices em uma nova migration sem alterar migrations aplicadas', () => {
        expect(fs.existsSync(MIGRATION_PATH)).toBe(true);

        const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
        for (const indexName of INDEXES) {
            expect(migrationSql).toMatch(
                new RegExp(`CREATE\\s+INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${indexName}\\b`, 'iu')
            );
        }
    });

    it('mantém o schema Prisma alinhado aos índices físicos', () => {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
        for (const indexName of INDEXES) {
            expect(schema).toContain(`map: "${indexName}"`);
        }
    });
});
