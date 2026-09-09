const { URL } = require('node:url');

function databaseIdentity(value) {
    try {
        const url = new URL(value);
        if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
        const name = decodeURIComponent(url.pathname.slice(1));
        const host = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            ? 'loopback' : url.hostname;
        return { name, key: `${host}:${url.port || '5432'}/${name}` };
    } catch {
        throw new Error('Use uma URL PostgreSQL valida para configurar o banco.');
    }
}

function getTestDatabaseUrl(env = process.env) {
    if (!env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST nao configurada.');
    const test = databaseIdentity(env.DATABASE_URL_TEST);
    if (!/(^test$|^test_|_test$)/.test(test.name)) {
        throw new Error('O nome do banco de teste deve ser test, iniciar com test_ ou terminar em _test.');
    }
    for (const value of [env.DATABASE_URL, env.DIRECT_URL]) {
        if (value && databaseIdentity(value).key === test.key) {
            throw new Error('O banco de teste deve ser diferente de DATABASE_URL e DIRECT_URL.');
        }
    }
    return env.DATABASE_URL_TEST;
}

module.exports = { getTestDatabaseUrl };
