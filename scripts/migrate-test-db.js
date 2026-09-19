require('dotenv').config();
const { spawnSync } = require('node:child_process');
const { getTestDatabaseUrl } = require('./test-database');

// Apply the versioned history without dropping schemas or accepting data loss.
const databaseUrl = getTestDatabaseUrl();
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' }
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
