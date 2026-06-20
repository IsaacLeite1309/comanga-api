import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const connectionString = process.env.NODE_ENV === 'test'
    ? process.env.DATABASE_URL_TEST
    : process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error(process.env.NODE_ENV === 'test'
        ? 'DATABASE_URL_TEST nao configurada.'
        : 'DATABASE_URL nao configurada.');
}

function shouldUseSsl(url: string): boolean {
    if (process.env.DATABASE_SSL === 'true') return true;
    if (process.env.DATABASE_SSL === 'false') return false;
    return !url.includes('localhost') && !url.includes('127.0.0.1');
}

const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString)
        ? { rejectUnauthorized: false }
        : false
});

pool.on('connect', () => {
    if (process.env.NODE_ENV !== 'test') {
        console.log('Banco de dados conectado com sucesso.');
    }
});

export = {
    query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> => pool.query<T>(text, params),
    pool
};
