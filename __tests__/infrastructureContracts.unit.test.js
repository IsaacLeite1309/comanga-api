const {
    NodemailerMailService
} = require('../src/infrastructure/mail/NodemailerMailService');
const {
    ExternalUrlMediaStorage
} = require('../src/infrastructure/media/ExternalUrlMediaStorage');
const {
    MemoryRateLimitStore
} = require('../src/infrastructure/rate-limit/MemoryRateLimitStore');
const {
    createAuthNotificationService
} = require('../src/modules/auth/AuthNotificationService');
const {
    createLoginRateLimiter,
    RATE_LIMIT_MESSAGE
} = require('../src/middlewares/loginRateLimiter');

function makeRateLimitResponse() {
    const response = {
        status: jest.fn(() => response),
        json: jest.fn(() => response),
        on: jest.fn()
    };
    return response;
}

describe('contratos de infraestrutura substituivel', () => {
    it('injeta um MailService falso no servico de notificacao de autenticacao', async () => {
        const mailService = {
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

    it('adapta o provedor Nodemailer sem expô-lo ao caso de uso', async () => {
        const provider = {
            sendActivationEmail: jest.fn().mockResolvedValue(undefined)
        };
        const service = new NodemailerMailService(provider);

        await service.sendActivationEmail('destino@teste.local', 'isaac', 'token');

        expect(provider.sendActivationEmail).toHaveBeenCalledWith(
            'destino@teste.local',
            'isaac',
            'token'
        );
    });

    it('mantem URLs HTTPS externas pela implementacao atual de MediaStorage', async () => {
        const storage = new ExternalUrlMediaStorage();

        await expect(storage.importFromUrl({
            sourceUrl: 'https://cdn.exemplo.test/capa.jpg'
        })).resolves.toEqual(expect.objectContaining({
            provider: 'external-url',
            secureUrl: 'https://cdn.exemplo.test/capa.jpg',
            publicId: null
        }));
    });

    it('recusa URL HTTP na implementacao externa', async () => {
        const storage = new ExternalUrlMediaStorage();

        await expect(storage.importFromUrl({
            sourceUrl: 'http://cdn.exemplo.test/capa.jpg'
        })).rejects.toMatchObject({
            statusCode: 400,
            code: 'MEDIA_SOURCE_URL_INVALID'
        });
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
});
