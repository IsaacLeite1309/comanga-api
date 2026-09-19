const db = require('../src/database');

const EXPECTED_INDEXES = [
    'idx_users_username_trgm',
    'idx_users_email_trgm',
    'idx_users_username_sort'
];

function collectIndexNames(node, names = new Set()) {
    if (!node || typeof node !== 'object') return names;

    if (typeof node['Index Name'] === 'string') {
        names.add(node['Index Name']);
    }

    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const child of value) collectIndexNames(child, names);
        } else if (value && typeof value === 'object') {
            collectIndexNames(value, names);
        }
    }

    return names;
}

async function explainAnalyze(sql, params = [], { forceBitmap = false } = {}) {
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');
        await client.query('SET LOCAL enable_seqscan = off');
        if (forceBitmap) {
            await client.query('SET LOCAL enable_indexscan = off');
            await client.query('SET LOCAL enable_indexonlyscan = off');
        }
        const result = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
        await client.query('ROLLBACK');

        return [...collectIndexNames(result.rows[0]['QUERY PLAN'][0])];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

describe('planos de consulta da administracao de usuarios', () => {
    it('mantem os indices administrativos instalados no banco de teste', async () => {
        const indexes = await db.query(
            `SELECT indexname
             FROM pg_indexes
             WHERE schemaname = 'public'
               AND indexname = ANY($1::text[])`,
            [EXPECTED_INDEXES]
        );

        expect(indexes.rows.map(({ indexname }) => indexname).sort()).toEqual(
            [...EXPECTED_INDEXES].sort()
        );
    });

    it.each([
        ['username', 'idx_users_username_trgm'],
        ['email', 'idx_users_email_trgm']
    ])('usa o indice GIN na busca parcial por %s', async (column, indexName) => {
        const plan = await explainAnalyze(
            `SELECT id
             FROM users
             WHERE ${column} ILIKE $1
             LIMIT 8`,
            ['%admin_plan_term%'],
            { forceBitmap: true }
        );

        expect(plan).toContain(indexName);
    });

    it('usa o indice B-Tree ao ordenar username de forma decrescente', async () => {
        const plan = await explainAnalyze(
            `SELECT id, username
             FROM users
             ORDER BY username DESC
             LIMIT 8`
        );

        expect(plan).toContain('idx_users_username_sort');
    });

    it('mantem filtros combinados na consulta administrativa', async () => {
        const plan = await explainAnalyze(
            `SELECT id
             FROM users
             WHERE username ILIKE $1
               AND nivel_acesso = $2
               AND status = $3
             ORDER BY username
             LIMIT 8`,
            ['%admin_plan_term%', 'Administrador', 'Ativada'],
            { forceBitmap: true }
        );

        expect(plan).toContain('idx_users_username_trgm');
    });
});
