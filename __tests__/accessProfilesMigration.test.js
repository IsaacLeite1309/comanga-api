const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../src/database');

const migrationSql = fs.readFileSync(path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260920120000_perfis_de_acesso',
    'migration.sql'
), 'utf8');

// Recria o estado anterior à migration para exercitá-la sobre dados já existentes.
const undoSql = `
    DROP TRIGGER IF EXISTS users_sincroniza_perfis_insert ON users;
    DROP TRIGGER IF EXISTS users_sincroniza_perfis_update ON users;
    DROP FUNCTION IF EXISTS sincroniza_perfis_por_nivel_acesso();
    ALTER TABLE sessions DROP COLUMN IF EXISTS active_profile_id;
    ALTER TABLE users DROP COLUMN IF EXISTS preferred_profile_id;
    DROP TABLE IF EXISTS user_profiles;
    DROP TABLE IF EXISTS profiles;
`;

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'migracao-perfis.local';

function legacyUser(suffix, nivelAcesso, status) {
    return {
        username: `mig_${runId}_${suffix}`.slice(0, 50),
        email: `mig_${runId}_${suffix}@${testEmailDomain}`,
        nivelAcesso,
        status
    };
}

async function insertLegacyUser(client, user) {
    const result = await client.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso)
         VALUES ($1, $2, 'hash-legado', $3, $4)
         RETURNING id`,
        [user.username, user.email, user.status, user.nivelAcesso]
    );

    return result.rows[0].id;
}

async function insertLegacySession(client, userId) {
    const tokenHash = crypto.randomBytes(32).toString('hex');
    const result = await client.query(
        `INSERT INTO sessions (user_id, session_token_hash)
         VALUES ($1, $2)
         RETURNING id`,
        [userId, tokenHash]
    );

    return result.rows[0].id;
}

describe('migration dos perfis de acesso sobre dados existentes', () => {
    it('preserva contas, status e sessões, e distribui perfis conforme o nível legado', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(undoSql);

            const adminId = await insertLegacyUser(client, legacyUser('admin', 'Administrador', 'Ativada'));
            const standardId = await insertLegacyUser(client, legacyUser('comum', 'Usuário Padrão', 'Ativada'));
            const pendingId = await insertLegacyUser(client, legacyUser('pendente', 'Usuário Padrão', 'Pendente'));
            const adminSessionId = await insertLegacySession(client, adminId);
            const standardSessionId = await insertLegacySession(client, standardId);

            await client.query(migrationSql);

            const preserved = await client.query(
                'SELECT id, status, nivel_acesso FROM users WHERE id = ANY($1::uuid[]) ORDER BY nivel_acesso, status',
                [[adminId, standardId, pendingId]]
            );
            expect(preserved.rows).toEqual([
                { id: adminId, status: 'Ativada', nivel_acesso: 'Administrador' },
                { id: standardId, status: 'Ativada', nivel_acesso: 'Usuário Padrão' },
                { id: pendingId, status: 'Pendente', nivel_acesso: 'Usuário Padrão' }
            ]);

            const assignments = await client.query(
                `SELECT up.user_id, p.code FROM user_profiles up
                 JOIN profiles p ON p.id = up.profile_id
                 WHERE up.user_id = ANY($1::uuid[])
                 ORDER BY up.user_id, p.code`,
                [[adminId, standardId, pendingId]]
            );
            const byUser = assignments.rows.reduce((accumulator, row) => {
                accumulator[row.user_id] = [...(accumulator[row.user_id] || []), row.code];
                return accumulator;
            }, {});
            expect(byUser[adminId]).toEqual(['ADMINISTRADOR', 'USUARIO_PADRAO']);
            expect(byUser[standardId]).toEqual(['USUARIO_PADRAO']);
            expect(byUser[pendingId]).toEqual(['USUARIO_PADRAO']);

            const preferences = await client.query(
                `SELECT u.id, p.code FROM users u
                 JOIN profiles p ON p.id = u.preferred_profile_id
                 WHERE u.id = ANY($1::uuid[])`,
                [[adminId, standardId]]
            );
            const preferenceByUser = Object.fromEntries(preferences.rows.map((row) => [row.id, row.code]));
            expect(preferenceByUser[adminId]).toBe('ADMINISTRADOR');
            expect(preferenceByUser[standardId]).toBe('USUARIO_PADRAO');

            const sessions = await client.query(
                `SELECT s.id, s.revoked_at, p.code FROM sessions s
                 JOIN profiles p ON p.id = s.active_profile_id
                 WHERE s.id = ANY($1::int[])
                 ORDER BY s.id`,
                [[adminSessionId, standardSessionId]]
            );
            expect(sessions.rows).toHaveLength(2);
            expect(sessions.rows.every((row) => row.revoked_at === null)).toBe(true);
            expect(sessions.rows.find((row) => row.id === adminSessionId).code).toBe('ADMINISTRADOR');
            expect(sessions.rows.find((row) => row.id === standardSessionId).code).toBe('USUARIO_PADRAO');
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it('semeia os perfis do sistema de forma idempotente', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(undoSql);
            await client.query(migrationSql);

            await client.query(`
                INSERT INTO profiles (code, name, is_system)
                VALUES ('USUARIO_PADRAO', 'Usuário Padrão', TRUE),
                       ('ADMINISTRADOR', 'Administrador', TRUE)
                ON CONFLICT (code) DO NOTHING;
            `);

            const result = await client.query('SELECT code FROM profiles ORDER BY code');
            expect(result.rows.map((row) => row.code)).toEqual(['ADMINISTRADOR', 'USUARIO_PADRAO']);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    it('mantém a ponte de compatibilidade com o campo legado nivel_acesso', async () => {
        const client = await db.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(undoSql);
            await client.query(migrationSql);

            const userId = await insertLegacyUser(client, legacyUser('ponte', 'Usuário Padrão', 'Ativada'));
            const depois = async () => (await client.query(
                `SELECT p.code FROM user_profiles up
                 JOIN profiles p ON p.id = up.profile_id
                 WHERE up.user_id = $1 ORDER BY p.code`,
                [userId]
            )).rows.map((row) => row.code);

            expect(await depois()).toEqual(['USUARIO_PADRAO']);

            await client.query("UPDATE users SET nivel_acesso = 'Administrador' WHERE id = $1", [userId]);
            expect(await depois()).toEqual(['ADMINISTRADOR', 'USUARIO_PADRAO']);

            await client.query("UPDATE users SET nivel_acesso = 'Usuário Padrão' WHERE id = $1", [userId]);
            expect(await depois()).toEqual(['USUARIO_PADRAO']);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});
