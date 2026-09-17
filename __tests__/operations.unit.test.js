describe('operacao da API', () => {
    it('protege metricas de processo e conexoes com chave operacional', async () => {
        const express = require('express');
        const request = require('supertest');
        const { createHealthRouter } = require('../src/infrastructure/operations/healthRouter');
        const app = express();
        const readMetrics = jest.fn().mockResolvedValue({
            process: {
                cpuUserMicros: 100,
                cpuSystemMicros: 50,
                rssBytes: 1024,
                heapUsedBytes: 512
            },
            database: { connections: 2 }
        });
        app.use('/health', createHealthRouter({
            metricsToken: 'ops-secret',
            readMetrics,
            now: () => new Date('2026-08-11T12:00:00.000Z')
        }));

        expect((await request(app).get('/health/metrics')).status).toBe(403);

        const response = await request(app)
            .get('/health/metrics')
            .set('x-ops-token', 'ops-secret');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            timestamp: '2026-08-11T12:00:00.000Z',
            process: {
                cpuUserMicros: 100,
                cpuSystemMicros: 50,
                rssBytes: 1024,
                heapUsedBytes: 512
            },
            database: { connections: 2 }
        });
    });

    it('gera logs JSON estruturados sem stack trace em producao', () => {
        const writeInfo = jest.fn();
        const writeError = jest.fn();
        const { createStructuredLogger } = require('../src/infrastructure/logging/structuredLogger');
        const logger = createStructuredLogger({
            environment: 'production',
            writeInfo,
            writeError,
            now: () => new Date('2026-08-11T12:00:00.000Z')
        });

        logger.error('api.unexpected_error', {
            requestId: 'req-123',
            route: '/api/public/works'
        }, new Error('database secret'));

        expect(writeError).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(writeError.mock.calls[0][0]);
        expect(payload).toEqual(expect.objectContaining({
            level: 'error',
            event: 'api.unexpected_error',
            timestamp: '2026-08-11T12:00:00.000Z',
            requestId: 'req-123',
            route: '/api/public/works',
            error: {
                name: 'Error',
                message: 'database secret'
            }
        }));
        expect(payload.error).not.toHaveProperty('stack');
    });

    it('registra conclusao da requisicao com identificador e duracao', () => {
        const logger = { info: jest.fn(), error: jest.fn() };
        const times = [1000, 1035];
        const { createRequestLogger } = require('../src/middlewares/requestLogger');
        const middleware = createRequestLogger({
            logger,
            now: () => times.shift()
        });
        let finish;
        const req = {
            requestId: 'req-456',
            method: 'GET',
            originalUrl: '/api/public/works?page=1',
            baseUrl: '/api/public', route: { path: '/works' },
            ip: '203.0.113.10'
        };
        const res = {
            statusCode: 200,
            on: jest.fn((event, callback) => {
                if (event === 'finish') finish = callback;
            })
        };
        const next = jest.fn();

        middleware(req, res, next);
        finish();

        expect(next).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith('http.request.completed', {
            requestId: 'req-456',
            method: 'GET',
            route: '/api/public/works',
            statusCode: 200,
            durationMs: 35,
            ip: '203.0.113.10'
        });
    });

    it('encerra HTTP e Prisma uma unica vez ao receber sinal', async () => {
        const callbacks = {};
        const processRef = {
            once: jest.fn((signal, callback) => {
                callbacks[signal] = callback;
            }),
            exit: jest.fn(),
            exitCode: undefined
        };
        const server = {
            close: jest.fn((callback) => callback()),
            closeIdleConnections: jest.fn(),
            closeAllConnections: jest.fn()
        };
        const disconnect = jest.fn().mockResolvedValue(undefined);
        const logger = { info: jest.fn(), error: jest.fn() };
        const { installGracefulShutdown } = require('../src/infrastructure/operations/gracefulShutdown');
        const lifecycle = installGracefulShutdown({
            server,
            disconnect,
            processRef,
            logger,
            timeoutMs: 1000
        });

        await Promise.all([
            lifecycle.shutdown('SIGTERM'),
            lifecycle.shutdown('SIGTERM')
        ]);

        expect(processRef.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
        expect(processRef.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(server.close).toHaveBeenCalledTimes(1);
        expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(processRef.exit).not.toHaveBeenCalled();
        expect(processRef.exitCode).toBe(0);
    });
});
