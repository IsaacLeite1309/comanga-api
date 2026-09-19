const { configurePrismaConnectionUrl } = require('../src/infrastructure/database/prismaConnectionUrl');

describe('configuracao do pool Prisma', () => {
    it('aplica limites conservadores sem perder os parametros do Neon', () => {
        const configured = new globalThis.URL(configurePrismaConnectionUrl(
            'postgresql://user:pass@neon.test/database?sslmode=require&channel_binding=require',
            {}
        ));

        expect(configured.searchParams.get('sslmode')).toBe('require');
        expect(configured.searchParams.get('channel_binding')).toBe('require');
        expect(configured.searchParams.get('connection_limit')).toBe('5');
        expect(configured.searchParams.get('pool_timeout')).toBe('10');
    });

    it('respeita valores explicitos da URL acima das configuracoes locais', () => {
        const configured = new globalThis.URL(configurePrismaConnectionUrl(
            'postgresql://user:pass@neon.test/database?connection_limit=2&pool_timeout=7',
            {
                PRISMA_CONNECTION_LIMIT: '8',
                PRISMA_POOL_TIMEOUT_SECONDS: '20'
            }
        ));

        expect(configured.searchParams.get('connection_limit')).toBe('2');
        expect(configured.searchParams.get('pool_timeout')).toBe('7');
    });

    it('aceita limites configurados por ambiente', () => {
        const configured = new globalThis.URL(configurePrismaConnectionUrl(
            'postgresql://user:pass@neon.test/database',
            {
                PRISMA_CONNECTION_LIMIT: '3',
                PRISMA_POOL_TIMEOUT_SECONDS: '15'
            }
        ));

        expect(configured.searchParams.get('connection_limit')).toBe('3');
        expect(configured.searchParams.get('pool_timeout')).toBe('15');
    });
});
