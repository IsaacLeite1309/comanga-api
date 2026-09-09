const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/database');

const MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260811120000_sanitize_domain_values_and_remove_legacy_publisher',
    'migration.sql'
);
const SLUG_MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260811150000_add_work_slugs',
    'migration.sql'
);

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'domain-integrity-test.local';

async function deleteFixtures() {
    await db.query('DELETE FROM works WHERE title LIKE $1', [`integrity_${runId}%`]);
    await db.query('DELETE FROM users WHERE email LIKE $1', [`%@${testEmailDomain}`]);
    await db.query('DELETE FROM domain_option_values WHERE label LIKE $1', [`integrity_${runId}%`]);
}

async function createOptionId(categorySlug) {
    const category = await db.query(
        `INSERT INTO domain_option_categories (slug, name)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [categorySlug, `Categoria ${categorySlug}`]
    );
    const option = await db.query(
        `INSERT INTO domain_option_values (category_id, label)
         VALUES ($1, $2)
         RETURNING id`,
        [category.rows[0].id, `integrity_${runId}_${categorySlug}`]
    );

    return option.rows[0].id;
}

describe('integridade dos valores fechados do dominio', () => {
    beforeEach(deleteFixtures);
    afterEach(deleteFixtures);

    it('mantem os defaults canonicos da conta e rejeita nivel de acesso invalido', async () => {
        const username = `integrity_${runId}`.slice(0, 20);
        const email = `integrity_${runId}@${testEmailDomain}`;

        const inserted = await db.query(
            `INSERT INTO users (username, email, password_hash)
             VALUES ($1, $2, 'hash_de_teste')
             RETURNING status, nivel_acesso`,
            [username, email]
        );

        expect(inserted.rows[0]).toEqual({
            status: 'Pendente',
            nivel_acesso: 'Usuário Padrão'
        });

        await expect(db.query(
            `UPDATE users
             SET nivel_acesso = 'Superusuário'
             WHERE email = $1`,
            [email]
        )).rejects.toMatchObject({ code: '23514' });
    });

    it('impede valores de visibilidade fora do dominio', async () => {
        const typeId = await createOptionId('tipos-obra');

        await expect(db.query(
            `INSERT INTO works (
                title,
                slug,
                type_id,
                country,
                original_publication_status,
                visibility,
                atualizado_em
             ) VALUES ($1, $2, $3, 'Japão', 'Completo', 'Oculto', NOW())`,
            [`integrity_${runId}_invalid_visibility`, `integrity-${runId}-invalid-visibility`, typeId]
        )).rejects.toMatchObject({ code: '23514' });
    });

    it('migra a Editora singular para o vinculo ordenado e remove a coluna legada', async () => {
        const typeId = await createOptionId('tipos-obra');
        const publisherId = await createOptionId('editoras-originais');
        const workResult = await db.query(
            `INSERT INTO works (
                title,
                slug,
                type_id,
                country,
                original_publication_status,
                atualizado_em
             ) VALUES ($1, $2, $3, 'Japão', 'Completo', NOW())
             RETURNING id`,
            [`integrity_${runId}_publisher`, `integrity-${runId}-publisher`, typeId]
        );
        const workId = workResult.rows[0].id;

        await db.query('ALTER TABLE works ADD COLUMN IF NOT EXISTS original_publisher_id INTEGER');
        await db.query(
            'UPDATE works SET original_publisher_id = $1 WHERE id = $2',
            [publisherId, workId]
        );

        const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
        await db.query(migrationSql);

        const migratedRelation = await db.query(
            `SELECT publisher_id, position
             FROM work_original_publishers
             WHERE work_id = $1`,
            [workId]
        );
        const legacyColumn = await db.query(
            `SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'works'
               AND column_name = 'original_publisher_id'`
        );

        expect(migratedRelation.rows).toEqual([
            { publisher_id: publisherId, position: 0 }
        ]);
        expect(legacyColumn.rows).toHaveLength(0);
    });

    it('garante slug unico e preserva sua identidade quando o titulo muda', async () => {
        const typeId = await createOptionId('tipos-obra');
        const title = `integrity_${runId}_slug`;
        const slug = `integrity-${runId}-slug`;

        const inserted = await db.query(
            `INSERT INTO works (
                title,
                slug,
                type_id,
                country,
                original_publication_status,
                atualizado_em
             ) VALUES ($1, $2, $3, 'Japão', 'Completo', NOW())
             RETURNING id, slug`,
            [title, slug, typeId]
        );

        await expect(db.query(
            `INSERT INTO works (
                title,
                slug,
                type_id,
                country,
                original_publication_status,
                atualizado_em
             ) VALUES ($1, $2, $3, 'Japão', 'Completo', NOW())`,
            [`${title}_duplicated`, slug, typeId]
        )).rejects.toMatchObject({ code: '23505' });

        const updated = await db.query(
            'UPDATE works SET title = $1 WHERE id = $2 RETURNING slug',
            [`${title}_renamed`, inserted.rows[0].id]
        );

        expect(updated.rows[0].slug).toBe(slug);
    });

    it('preenche slugs de registros existentes e resolve colisoes na migration', async () => {
        const typeId = await createOptionId('tipos-obra');
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('DROP INDEX works_slug_key');
            await client.query('ALTER TABLE works ALTER COLUMN slug DROP NOT NULL');
            await client.query(
                `INSERT INTO works (
                    title,
                    slug,
                    type_id,
                    country,
                    original_publication_status,
                    atualizado_em
                 ) VALUES
                    ($1, NULL, $3, 'Japão', 'Completo', NOW()),
                    ($2, NULL, $3, 'Japão', 'Completo', NOW())`,
                [
                    `integrity_${runId}_Ação Total`,
                    `integrity_${runId}_Acao Total`,
                    typeId
                ]
            );

            await client.query(fs.readFileSync(SLUG_MIGRATION_PATH, 'utf8'));

            const migrated = await client.query(
                `SELECT slug
                 FROM works
                 WHERE title IN ($1, $2)
                 ORDER BY slug`,
                [`integrity_${runId}_Ação Total`, `integrity_${runId}_Acao Total`]
            );

            expect(migrated.rows).toEqual([
                { slug: `integrity-${runId.toLowerCase().replace(/_/g, '-')}-acao-total` },
                { slug: `integrity-${runId.toLowerCase().replace(/_/g, '-')}-acao-total-2` }
            ]);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});
