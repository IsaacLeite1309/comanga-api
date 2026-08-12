const request = require('supertest');

const prisma = {
    $queryRaw: jest.fn()
};

jest.mock('../src/prisma', () => prisma);

const app = require('../src/app');

describe('app unitario', () => {
    const originalCorsOrigin = process.env.CORS_ORIGIN;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
        process.env.CORS_ORIGIN = originalCorsOrigin;
    });

    it('responde ping quando API e banco estao online', async () => {
        const now = new Date('2026-01-01T10:00:00.000Z');
        prisma.$queryRaw.mockResolvedValue([{ hora_atual: now }]);

        const response = await request(app).get('/ping');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({
            status: 'Online',
            message: 'API e Banco de Dados operando perfeitamente!'
        }));
        expect(response.headers['x-request-id']).toEqual(expect.any(String));
    });

    it('permite origem configurada no CORS', async () => {
        prisma.$queryRaw.mockResolvedValue([{ hora_atual: new Date('2026-01-01T10:00:00.000Z') }]);

        const response = await request(app)
            .get('/ping')
            .set('Origin', 'http://localhost:8080');

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    });

    it('responde erro critico quando banco falha no ping', async () => {
        prisma.$queryRaw.mockRejectedValue(new Error('db off'));

        const response = await request(app).get('/ping');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
            error: 'Erro interno do servidor.',
            code: 'DATABASE_UNAVAILABLE'
        });
        expect(JSON.stringify(response.body)).not.toContain('db off');
    });

    it('responde health de vida sem consultar o banco', async () => {
        const response = await request(app).get('/health/live');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({
            status: 'alive',
            requestId: expect.any(String),
            timestamp: expect.any(String),
            uptimeSeconds: expect.any(Number)
        }));
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('responde health de prontidao quando o banco esta acessivel', async () => {
        const now = new Date('2026-01-01T10:00:00.000Z');
        prisma.$queryRaw.mockResolvedValue([{ hora_atual: now }]);

        const response = await request(app).get('/health/ready');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({
            status: 'ready',
            checks: { database: 'up' },
            databaseTime: now.toISOString()
        }));
    });

    it('responde 503 no health de prontidao quando o banco esta indisponivel', async () => {
        prisma.$queryRaw.mockRejectedValue(new Error('db off'));

        const response = await request(app).get('/health/ready');

        expect(response.status).toBe(503);
        expect(response.body).toEqual(expect.objectContaining({
            status: 'unavailable',
            code: 'DATABASE_UNAVAILABLE',
            checks: { database: 'down' }
        }));
        expect(JSON.stringify(response.body)).not.toContain('db off');
    });

    it('bloqueia origem nao permitida pelo CORS', async () => {
        const response = await request(app)
            .get('/ping')
            .set('Origin', 'https://origem-nao-permitida.test');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
            error: 'Origem não permitida pelo CORS.',
            code: 'CORS_ORIGIN_DENIED'
        });
    });

    it('responde rota inexistente em JSON padronizado', async () => {
        const response = await request(app).get('/rota-inexistente');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
            error: 'Rota não encontrada.',
            code: 'ROUTE_NOT_FOUND'
        });
    });

    it('protege a prova de conceito de midia com autenticacao administrativa', async () => {
        const response = await request(app)
            .post('/api/admin/media/poc/covers')
            .send({ url: 'https://origem.test/capa.jpg' });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({
            error: 'Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.'
        });
    });
});
