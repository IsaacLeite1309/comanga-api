const fs = require('node:fs');
const path = require('node:path');

const apiRoot = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(apiRoot, 'prisma', 'schema.prisma'), 'utf8');
const migrationPath = path.join(
    apiRoot,
    'prisma',
    'migrations',
    '20260818233000_reconcile_prisma_physical_schema',
    'migration.sql'
);

describe('reconciliacao entre Prisma Schema e estrutura fisica', () => {
    it.each([
        'idx_users_username_trgm',
        'idx_users_email_trgm',
        'idx_users_username_sort',
        'idx_sessions_token_hash',
        'idx_domain_option_values_category_active_label',
        'work_authors_work_author_unique'
    ])('representa no Prisma o indice fisico %s', (indexName) => {
        expect(schema).toContain(`map: "${indexName}"`);
    });

    it('representa defaults e acoes referenciais existentes sem recriar FKs', () => {
        expect(schema).toMatch(/atualizadoEm\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt/g);
        expect(schema).toContain('onDelete: Cascade, onUpdate: NoAction');
        expect(schema).toContain('onDelete: Restrict, onUpdate: NoAction');
        expect(schema).toContain('map: "work_author_roles_work_author_fkey"');
    });

    it('versiona backfill seguro e obrigatoriedade sem remover indices dependentes', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toMatch(/UPDATE users[\s\S]*conteudo_adulto = COALESCE\(conteudo_adulto, FALSE\)/);
        expect(sql).toMatch(/ALTER COLUMN conteudo_adulto SET NOT NULL/);
        expect(sql).toMatch(/ALTER COLUMN last_used_at SET NOT NULL/);
        expect(sql).toMatch(/ALTER COLUMN criado_em SET NOT NULL/);
        expect(sql).not.toMatch(/DROP INDEX[\s\S]*work_authors_work_author_unique/);
    });
});
