const {
    ResendMailService
} = require('../src/infrastructure/mail/ResendMailService');
const {
    MemoryRateLimitStore
} = require('../src/infrastructure/rate-limit/MemoryRateLimitStore');
const {
    createAuthNotificationService
} = require('../src/modules/auth/AuthNotificationService');
const {
    createLoginRateLimiter,
    RATE_LIMIT_MESSAGE,
    LOGIN_FAILURE_WINDOW_MS
} = require('../src/middlewares/loginRateLimiter');

function makeRateLimitResponse() {
    const response = {
        status: jest.fn(() => response),
        json: jest.fn(() => response),
        on: jest.fn((event, callback) => {
            if (event === 'finish') response.finishCallback = callback;
        })
    };
    return response;
}

describe('contratos de infraestrutura substituivel', () => {
    it('injeta um MailService falso no servico de notificacao de autenticacao', async () => {
        const mailService = {
            sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
            sendActivationEmail: jest.fn().mockResolvedValue(undefined)
        };
        const notifications = createAuthNotificationService({ mailService });

        await notifications.sendActivationEmail({
            toEmail: 'leitor@teste.local',
            username: 'leitor',
            token: 'token-123'
        });

        expect(mailService.sendActivationEmail).toHaveBeenCalledWith(
            'leitor@teste.local',
            'leitor',
            'token-123'
        );
    });

    it('adapta o provedor Resend sem expô-lo ao caso de uso', async () => {
        const provider = {
            sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
            sendActivationEmail: jest.fn().mockResolvedValue(undefined)
        };
        const service = new ResendMailService(provider);

        await service.sendActivationEmail('destino@teste.local', 'isaac', 'token');
        await service.sendPasswordResetEmail('destino@teste.local', 'isaac', 'reset');
        expect(provider.sendPasswordResetEmail).toHaveBeenCalledWith('destino@teste.local', 'isaac', 'reset');

        expect(provider.sendActivationEmail).toHaveBeenCalledWith(
            'destino@teste.local',
            'isaac',
            'token'
        );
    });

    it('permite substituir o armazenamento em memoria por meio do contrato de rate limiting', () => {
        const store = new MemoryRateLimitStore();

        store.set('ip:198.51.100.10', { failedAttempts: 2, firstFailedAt: 10 });
        expect(store.get('ip:198.51.100.10')).toEqual({ failedAttempts: 2, firstFailedAt: 10 });
        store.delete('ip:198.51.100.10');
        expect(store.get('ip:198.51.100.10')).toBeUndefined();

        store.set('outro', { failedAttempts: 1, firstFailedAt: 20 });
        store.clear();
        expect(store.get('outro')).toBeUndefined();
    });

    it('injeta um RateLimitStore falso no consumidor do middleware', () => {
        const store = {
            get: jest.fn().mockReturnValue({ failedAttempts: 5, firstFailedAt: 1_000 }),
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn()
        };
        const limiter = createLoginRateLimiter({ store, now: () => 2_000 });
        const response = makeRateLimitResponse();
        const next = jest.fn();

        limiter.middleware({ ip: '203.0.113.15', socket: {} }, response, next);

        expect(store.get).toHaveBeenCalledWith('203.0.113.15');
        expect(response.status).toHaveBeenCalledWith(429);
        expect(response.json).toHaveBeenCalledWith({
            error: RATE_LIMIT_MESSAGE,
            code: 'LOGIN_RATE_LIMITED'
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('libera o IP quando a janela de cinco minutos expira', () => {
        let currentTime = 1_000;
        const store = new MemoryRateLimitStore();
        const limiter = createLoginRateLimiter({ store, now: () => currentTime });

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const response = makeRateLimitResponse();
            limiter.middleware({ ip: '203.0.113.20', socket: {} }, response, jest.fn());
            response.statusCode = 401;
            response.finishCallback();
        }

        const blockedResponse = makeRateLimitResponse();
        const blockedNext = jest.fn();
        limiter.middleware({ ip: '203.0.113.20', socket: {} }, blockedResponse, blockedNext);
        expect(blockedResponse.status).toHaveBeenCalledWith(429);
        expect(blockedNext).not.toHaveBeenCalled();

        currentTime += LOGIN_FAILURE_WINDOW_MS;
        const releasedResponse = makeRateLimitResponse();
        const releasedNext = jest.fn();
        limiter.middleware({ ip: '203.0.113.20', socket: {} }, releasedResponse, releasedNext);

        expect(releasedNext).toHaveBeenCalledTimes(1);
        expect(releasedResponse.status).not.toHaveBeenCalledWith(429);
        expect(store.get('203.0.113.20')).toBeUndefined();
    });
});
