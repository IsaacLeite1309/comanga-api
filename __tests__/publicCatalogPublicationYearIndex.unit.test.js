const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260912020000_add_public_catalog_publication_year_index',
    'migration.sql'
);
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const INDEX_NAME = 'idx_volumes_edition_visibility_number_year';

describe('índice do período de publicação das Edições', () => {
    it('versiona o índice que sustenta a busca pelo primeiro e último Volume público', () => {
        expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
        expect(fs.readFileSync(MIGRATION_PATH, 'utf8')).toMatch(
            new RegExp(`CREATE\\s+INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${INDEX_NAME}\\b`, 'iu')
        );
    });

    it('mantém o schema Prisma alinhado ao índice físico', () => {
        expect(fs.readFileSync(SCHEMA_PATH, 'utf8')).toContain(`map: "${INDEX_NAME}"`);
    });
});
