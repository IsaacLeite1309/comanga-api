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

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }

    await seedDomainOptions();
    process.exit(0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
