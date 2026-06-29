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
        expect(response.body).toEqual(expect.objectContaining({
            status: 'Erro Critico',
            message: 'API online, mas o Banco de Dados falhou.',
            error: 'db off'
        }));
    });

    it('bloqueia origem nao permitida pelo CORS', async () => {
        const response = await request(app)
            .get('/ping')
            .set('Origin', 'https://origem-nao-permitida.test');

        expect(response.status).toBe(500);
    });
});
