require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ADMIN_USERS_INDEXES_MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260630190000_admin_users_indexes',
    'migration.sql'
);

const INTEGRITY_MIGRATION_PATH = path.join(
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
const PUBLIC_CATALOG_INDEXES_MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260812150000_public_catalog_indexes',
    'migration.sql'
);
const VOLUME_RELEASE_DATE_MIGRATION_PATH = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260818120000_enforce_volume_release_date',
    'migration.sql'
);

if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST nao configurada.');
}

async function resetTestSchemaAndEnsureExtensions() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL_TEST,
        ssl: process.env.DATABASE_SSL === 'false'
            ? false
            : { rejectUnauthorized: false }
    });

    try {
        await pool.query(`
            DROP SCHEMA IF EXISTS public CASCADE;
            CREATE SCHEMA public;
            CREATE EXTENSION IF NOT EXISTS pgcrypto;
            CREATE EXTENSION IF NOT EXISTS pg_trgm;
        `);
    } finally {
        await pool.end();
    }
}

async function seedDomainOptions() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL_TEST,
        ssl: process.env.DATABASE_SSL === 'false'
            ? false
            : { rejectUnauthorized: false }
    });

    const categories = [
        ['autores', 'Autores'],
        ['papeis-autoria', 'Papéis de autoria'],
        ['tipos-obra', 'Tipos de Obra'],
        ['paises-origem', 'Países de Origem'],
        ['demografias', 'Demografias'],
        ['generos', 'Gêneros'],
        ['status-publicacao-original', 'Status de Publicação Original'],
        ['revistas-serializacao', 'Revistas de Serialização'],
        ['editoras-originais', 'Editoras Originais'],
        ['editoras-brasileiras', 'Editoras Brasileiras'],
        ['tipos-edicao', 'Tipos de Edição'],
        ['tipos-capa', 'Acabamento'],
        ['formatos-fisicos', 'Formato'],
        ['miolos', 'Miolo'],
        ['numeros-cronologicos-edicao', 'Números Cronológicos de Edição'],
        ['status-publicacao-brasil', 'Status de Publicação no Brasil']
    ];

    try {
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS domain_option_values_category_label_unique
            ON domain_option_values (category_id, LOWER(label));
        `);

        for (const [slug, name] of categories) {
            await pool.query(
                `INSERT INTO domain_option_categories (slug, name)
                 VALUES ($1, $2)
                 ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
                [slug, name]
            );
        }
    } finally {
        await pool.end();
    }
}

async function applyIntegrityMigration() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL_TEST,
        ssl: process.env.DATABASE_SSL === 'false'
            ? false
            : { rejectUnauthorized: false }
    });

    try {
        for (const migrationPath of [
            ADMIN_USERS_INDEXES_MIGRATION_PATH,
            INTEGRITY_MIGRATION_PATH,
            SLUG_MIGRATION_PATH,
            PUBLIC_CATALOG_INDEXES_MIGRATION_PATH,
            VOLUME_RELEASE_DATE_MIGRATION_PATH
        ]) {
            const migrationSql = fs.readFileSync(migrationPath, 'utf8');
            await pool.query(migrationSql);
        }
    } finally {
        await pool.end();
    }
}

async function run() {
    await resetTestSchemaAndEnsureExtensions();

    const result = spawnSync(
        process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
        ['db', 'push', '--accept-data-loss'],
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

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }

    await applyIntegrityMigration();
    await seedDomainOptions();
    process.exit(0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
