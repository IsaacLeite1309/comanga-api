require('dotenv').config();
const { spawnSync } = require('child_process');

if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST nao configurada.');
}

const result = spawnSync(
    process.platform === 'win32' ? 'node-pg-migrate.cmd' : 'node-pg-migrate',
    ['up'],
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
