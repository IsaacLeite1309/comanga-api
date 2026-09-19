const db = require('../src/database');

describe('integridade física das capas internas', () => {
    it('mantém validadas as constraints técnicas e de estado', async () => {
        const result = await db.pool.query(`
            SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE conname IN (
                'media_assets_dimensions_check',
                'media_assets_bytes_check',
                'media_assets_status_check',
                'media_variants_dimensions_check'
            )
            ORDER BY conname
        `);

        expect(result.rows).toHaveLength(4);
        expect(result.rows.every((constraint) => constraint.convalidated)).toBe(true);
        expect(result.rows.find((constraint) => constraint.conname === 'media_assets_status_check').definition)
            .toContain("'Pendente'");
    });

    it('preserva o ativo e remove apenas a autoria quando a conta é excluída', async () => {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const user = await client.query(`
                INSERT INTO users (username, email, password_hash, status, nivel_acesso)
                VALUES ('media-auditor', 'media-auditor@comanga.test', 'hash', 'Ativada', 'Administrador')
                RETURNING id
            `);
            const asset = await client.query(`
                INSERT INTO media_assets (
                    provider, object_key, source_url, mime_type, format,
                    width, height, bytes, checksum, created_by_user_id
                ) VALUES (
                    'r2', 'covers/test/master.webp', 'https://origem.test/capa.jpg',
                    'image/webp', 'webp', 1200, 1800, 100, repeat('a', 64), $1
                ) RETURNING id
            `, [user.rows[0].id]);

            await client.query('DELETE FROM users WHERE id = $1', [user.rows[0].id]);
            const persisted = await client.query(
                'SELECT created_by_user_id FROM media_assets WHERE id = $1',
                [asset.rows[0].id]
            );

            expect(persisted.rows[0].created_by_user_id).toBeNull();
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});
