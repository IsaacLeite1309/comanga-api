const { spawnSync } = require('node:child_process');
const path = require('node:path');

const apiRoot = path.resolve(__dirname, '..', '..');
const prismaCli = require.resolve('prisma/build/index.js');

// O banco de teste recebe apenas `prisma migrate deploy`; qualquer diferença aqui significa
// que o schema declarado e as migrations versionadas descrevem estruturas distintas.
function migrateDiff(direction) {
    const target = process.env.DATABASE_URL_TEST;
    const args = direction === 'schema-para-banco'
        ? ['--from-schema-datamodel', 'prisma/schema.prisma', '--to-url', target]
        : ['--from-url', target, '--to-schema-datamodel', 'prisma/schema.prisma'];
    const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'diff', ...args, '--script'], {
        cwd: apiRoot,
        encoding: 'utf8',
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }
    });

    if (result.error) {
        throw new Error(`prisma migrate diff não iniciou (${result.error.code || result.error.name})`);
    }
    if (result.status !== 0) {
        // A mensagem do Prisma pode conter a URL do banco; só o código de saída é seguro no relatório.
        throw new Error(`prisma migrate diff terminou com código ${result.status}`);
    }
    return result.stdout.trim();
}

const EMPTY_DIFF = '-- This is an empty migration.';

describe('ausência de drift entre o schema Prisma e o banco migrado', () => {
    jest.setTimeout(120000);

    it('não encontra diferença estrutural do schema declarado para o banco de teste', () => {
        expect(migrateDiff('schema-para-banco')).toBe(EMPTY_DIFF);
    });

    it('não encontra diferença estrutural do banco de teste para o schema declarado', () => {
        expect(migrateDiff('banco-para-schema')).toBe(EMPTY_DIFF);
    });
});
