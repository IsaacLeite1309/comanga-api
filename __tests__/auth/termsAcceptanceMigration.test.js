const fs = require('node:fs');
const path = require('node:path');
const db = require('../../src/database');

const migrationSql = fs.readFileSync(path.join(
    __dirname, '../../prisma/migrations/20261118120000_add_user_terms_acceptance/migration.sql'
), 'utf8');

describe('migration dos termos de uso', () => {
    it('preserva conta existente sem preencher versão ou data de aceite', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('ALTER TABLE users DROP COLUMN terms_version, DROP COLUMN terms_accepted_at');
            const legacy = (await client.query(`
                INSERT INTO users (username, email, password_hash, status)
                VALUES ('legado_termos', 'legado@termos.test', 'hash-legado', 'Ativada')
                RETURNING id, status
            `)).rows[0];

            await client.query(migrationSql);

            const result = await client.query(`
                SELECT id, status, terms_version, terms_accepted_at FROM users WHERE id = $1
            `, [legacy.id]);
            expect(result.rows).toEqual([{ ...legacy, terms_version: null, terms_accepted_at: null }]);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it.each([
        ['2026-11-18', null],
        [null, '2026-11-18T12:00:00Z']
    ])('recusa aceite parcial (%p, %p)', async (version, acceptedAt) => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            await expect(client.query(`
                INSERT INTO users (username, email, password_hash, terms_version, terms_accepted_at)
                VALUES ('parcial_termos', 'parcial@termos.test', 'hash-teste', $1, $2)
            `, [version, acceptedAt])).rejects.toMatchObject({
                code: '23514',
                constraint: 'users_terms_acceptance_pair_check'
            });
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});
