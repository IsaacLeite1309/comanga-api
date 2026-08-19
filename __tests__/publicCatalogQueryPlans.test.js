const db = require('../src/database');

const EXPECTED_INDEXES = [
    'idx_works_title_trgm',
    'idx_works_original_title_trgm',
    'idx_domain_option_values_label_trgm',
    'idx_works_public_filters',
    'idx_works_visibility_title',
    'idx_work_authors_author_work',
    'idx_work_genres_genre_work',
    'idx_work_demographies_demography_work',
    'idx_editions_visibility_publisher',
    'idx_editions_visibility_format',
    'idx_editions_visibility_cover_type',
    'idx_volumes_calendar_release'
];

function collectIndexNames(node, names = new Set()) {
    if (!node || typeof node !== 'object') {
        return names;
    }

    if (typeof node['Index Name'] === 'string') {
        names.add(node['Index Name']);
    }

    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const child of value) {
                collectIndexNames(child, names);
            }
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
        // Bancos de teste vazios preferem varredura sequencial pelo custo. Estas
        // opcoes comprovam que os indices sao elegiveis sem falsificar estatisticas.
        await client.query('SET LOCAL enable_seqscan = off');
        if (forceBitmap) {
            // GIN produz bitmap scans; evita que um B-tree vazio seja escolhido
            // apenas por seu custo inicial equivalente.
            await client.query('SET LOCAL enable_indexscan = off');
            await client.query('SET LOCAL enable_indexonlyscan = off');
        }
        const result = await client.query(
            `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
            params
        );
        await client.query('ROLLBACK');

        return [...collectIndexNames(result.rows[0]['QUERY PLAN'][0])];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

describe('planos de consulta do catalogo publico', () => {
    it('mantem a extensao e os indices fisicos instalados no banco de teste', async () => {
        const extension = await db.query(
            "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'"
        );
        const indexes = await db.query(
            `SELECT indexname
             FROM pg_indexes
             WHERE schemaname = 'public'
               AND indexname = ANY($1::text[])`,
            [EXPECTED_INDEXES]
        );

        expect(extension.rows).toEqual([{ extname: 'pg_trgm' }]);
        expect(indexes.rows.map(({ indexname }) => indexname).sort()).toEqual(
            [...EXPECTED_INDEXES].sort()
        );
    });

    it('usa trigramas nas buscas parciais por titulo, titulo original e autor', async () => {
        const titlePlan = await explainAnalyze(
            `SELECT id
             FROM works
             WHERE title ILIKE $1
             LIMIT 50`,
            ['%catalog_plan_term%'],
            { forceBitmap: true }
        );
        const originalTitlePlan = await explainAnalyze(
            `SELECT id
             FROM works
             WHERE original_title ILIKE $1
             LIMIT 50`,
            ['%catalog_plan_term%'],
            { forceBitmap: true }
        );
        const authorPlan = await explainAnalyze(
            `SELECT wa.work_id
             FROM domain_option_values author
             JOIN work_authors wa ON wa.author_id = author.id
             WHERE author.label ILIKE $1
             LIMIT 50`,
            ['%catalog_plan_term%'],
            { forceBitmap: true }
        );

        expect(titlePlan).toContain('idx_works_title_trgm');
        expect(originalTitlePlan).toContain('idx_works_original_title_trgm');
        expect(authorPlan).toEqual(expect.arrayContaining([
            'idx_domain_option_values_label_trgm',
            'idx_work_authors_author_work'
        ]));
    });

    it('usa indices adequados ao intersectar visibilidade e classificacoes de Obras', async () => {
        const workPlan = await explainAnalyze(
            `SELECT id
             FROM works
             WHERE visibility = 'Público'
               AND adult_content = FALSE
               AND type_id = $1
               AND country = $2
             ORDER BY id
             LIMIT 50`,
            [2147483640, 'Japão']
        );
        const genrePlan = await explainAnalyze(
            `SELECT work_id
             FROM work_genres
             WHERE genre_id = ANY($1::integer[])
             GROUP BY work_id
             HAVING COUNT(DISTINCT genre_id) = cardinality($1::integer[])`,
            [[2147483640, 2147483641]]
        );
        const demographyPlan = await explainAnalyze(
            `SELECT work_id
             FROM work_demographies
             WHERE demography = ANY($1::varchar[])
             GROUP BY work_id
             HAVING COUNT(DISTINCT demography) = cardinality($1::varchar[])`,
            [['Shonen', 'Seinen']]
        );
        const plan = [...workPlan, ...genrePlan, ...demographyPlan];

        expect(plan).toEqual(expect.arrayContaining([
            'idx_works_public_filters',
            'idx_work_genres_genre_work'
        ]));
        expect(plan.some((indexName) => [
            'idx_work_demographies_demography_work',
            'work_demographies_pkey'
        ].includes(indexName))).toBe(true);
    });

    it.each([
        [
            'editora brasileira',
            'brazilian_publisher_id',
            'idx_editions_visibility_publisher'
        ],
        ['formato', 'format_id', 'idx_editions_visibility_format'],
        ['acabamento', 'cover_type_id', 'idx_editions_visibility_cover_type']
    ])('usa o indice de %s ao filtrar Edicoes publicas', async (_label, column, indexName) => {
        const plan = await explainAnalyze(
            `SELECT id
             FROM editions
             WHERE visibility = 'Público'
               AND ${column} = $1
             ORDER BY id
             LIMIT 50`,
            [2147483640]
        );

        expect(plan).toContain(indexName);
    });

    it('usa data de publicacao e editora brasileira nas consultas do calendario', async () => {
        const releasePlan = await explainAnalyze(
            `SELECT id, edition_id
             FROM volumes
             WHERE visibility = 'Público'
               AND release_year = $1
               AND release_month = $2
             ORDER BY release_year, release_month, release_day, id
             LIMIT 50`,
            [2099, 12]
        );
        const publisherPlan = await explainAnalyze(
            `SELECT id
             FROM editions
             WHERE brazilian_publisher_id = $1
               AND visibility = 'Público'
             ORDER BY id
             LIMIT 50`,
            [2147483640]
        );

        expect(releasePlan).toContain('idx_volumes_calendar_release');
        expect(publisherPlan).toContain('idx_editions_visibility_publisher');
    });
});
