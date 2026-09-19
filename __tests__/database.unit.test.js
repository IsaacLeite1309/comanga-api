const poolInstances = [];

jest.mock('pg', () => ({
    Pool: jest.fn(function Pool(config) {
        this.config = config;
        this.query = jest.fn().mockResolvedValue({ rows: [] });
        this.on = jest.fn();
        poolInstances.push(this);
    })
}));

describe('database helper unitario', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        poolInstances.length = 0;
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
            DATABASE_URL_TEST: 'postgres://user:pass@localhost:5432/testdb'
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('usa DATABASE_URL_TEST em ambiente de teste e desativa SSL local', async () => {
        const db = require('../src/database');

        await db.query('SELECT 1', [1]);

        expect(poolInstances[0].config).toEqual(expect.objectContaining({
            connectionString: 'postgres://user:pass@localhost:5432/testdb',
            ssl: false,
            max: 5,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 10000
        }));
        expect(poolInstances[0].query).toHaveBeenCalledWith('SELECT 1', [1]);
    });

    it('respeita DATABASE_SSL=true para forcar SSL', () => {
        process.env.DATABASE_SSL = 'true';

        require('../src/database');

        expect(poolInstances[0].config.ssl).toEqual({ rejectUnauthorized: false });
    });

    it('respeita DATABASE_SSL=false para desativar SSL', () => {
        process.env.DATABASE_SSL = 'false';
        process.env.DATABASE_URL_TEST = 'postgres://user:pass@db.neon.tech:5432/testdb';

        require('../src/database');

        expect(poolInstances[0].config.ssl).toBe(false);
    });

    it('permite ajustar o pool auxiliar por variaveis de ambiente', () => {
        process.env.PG_POOL_MAX = '3';
        process.env.PG_POOL_CONNECTION_TIMEOUT_MS = '2500';
        process.env.PG_POOL_IDLE_TIMEOUT_MS = '4000';

        require('../src/database');

        expect(poolInstances[0].config).toEqual(expect.objectContaining({
            max: 3,
            connectionTimeoutMillis: 2500,
            idleTimeoutMillis: 4000
        }));
    });

    it('falha quando DATABASE_URL_TEST nao esta configurada em teste', () => {
        delete process.env.DATABASE_URL_TEST;

        expect(() => require('../src/database')).toThrow('DATABASE_URL_TEST nao configurada.');
    });
});
