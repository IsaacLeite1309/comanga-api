require('dotenv').config();
const { spawnSync } = require('child_process');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST nao configurada.');
}

async function ensureUuidExtension() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL_TEST,
        ssl: process.env.DATABASE_SSL === 'false'
            ? false
            : { rejectUnauthorized: false }
    });

    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    } finally {
        await pool.end();
    }
}

async function run() {
    await ensureUuidExtension();

    const result = spawnSync(
        process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
        ['db', 'push', '--force-reset', '--accept-data-loss'],
        {
            stdio: 'inherit',
            shell: true,
            env: {
                ...process.env,
                DATABASE_URL: process.env.DATABASE_URL_TEST,
                NODE_ENV: 'test'
            }
        }
    );

    process.exit(result.status ?? 1);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
