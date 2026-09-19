const { getTestDatabaseUrl } = require('../scripts/test-database');

describe('isolamento do banco de testes', () => {
    it.each([
        {},
        { DATABASE_URL_TEST: 'invalid' },
        { DATABASE_URL_TEST: 'https://localhost/comanga_test' },
        { DATABASE_URL_TEST: 'postgresql://localhost/%invalid_test' },
        { DATABASE_URL_TEST: 'postgresql://localhost/comanga' },
        { DATABASE_URL_TEST: 'postgresql://localhost/comanga_test', DATABASE_URL: 'postgres://127.0.0.1:5432/comanga_test?sslmode=require' },
        { DATABASE_URL_TEST: 'postgresql://localhost/comanga_test', DATABASE_URL: 'postgres://localhost/%63omanga_test' },
        { DATABASE_URL_TEST: 'postgresql://localhost/comanga_test', DIRECT_URL: 'postgres://localhost/comanga_test' }
    ])('recusa configuracao ausente, invalida ou compartilhada (%#)', (env) => {
        expect(() => getTestDatabaseUrl(env)).toThrow();
    });

    it('aceita um banco de teste separado', () => {
        const url = 'postgresql://localhost/comanga_test';
        expect(getTestDatabaseUrl({ DATABASE_URL_TEST: url, DATABASE_URL: 'postgresql://localhost/comanga' })).toBe(url);
    });

    it('nao revela credenciais nos erros', () => {
        expect(() => getTestDatabaseUrl({ DATABASE_URL_TEST: 'postgresql://user:secret@/comanga_test' }))
            .toThrow(new Error('Use uma URL PostgreSQL valida para configurar o banco.'));
    });
});
