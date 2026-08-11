const prisma = {
    session: {
        findFirst: jest.fn(),
        update: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const authMiddleware = require('../src/middlewares/authMiddleware');
const rbacMiddleware = require('../src/middlewares/rbacMiddleware');
const loginRateLimiter = require('../src/middlewares/loginRateLimiter');
const errorHandler = require('../src/middlewares/errorHandler');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        on: jest.fn((_event, callback) => {
            res.finishCallback = callback;
            return res;
        }),
        statusCode: 200
    };

    return res;
}

describe('middlewares unitarios', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loginRateLimiter.resetLoginRateLimiter();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
    });

    describe('authMiddleware', () => {
        it('bloqueia requisicao sem cookie de sessao', async () => {
            const req = { headers: {} };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        it('bloqueia cookie sem sessao ativa no banco', async () => {
            prisma.session.findFirst.mockResolvedValue(null);
            const req = { headers: { cookie: 'comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(prisma.session.findFirst).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        it('bloqueia usuario com conta nao ativada', async () => {
            prisma.session.findFirst.mockResolvedValue({
                id: 1,
                user: {
                    id: 'user-1',
                    username: 'isaac',
                    email: 'user@teste.local',
                    nivelAcesso: 'UsuÃ¡rio PadrÃ£o',
                    status: 'Pendente'
                }
            });
            const req = { headers: { cookie: 'comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });

        it('injeta usuario e sessao quando a sessao e valida', async () => {
            prisma.session.findFirst.mockResolvedValue({
                id: 1,
                user: {
                    id: 'user-1',
                    username: 'isaac',
                    email: 'user@teste.local',
                    nivelAcesso: 'UsuÃ¡rio PadrÃ£o',
                    status: 'Ativada'
                }
            });
            prisma.session.update.mockResolvedValue({});
            const req = { headers: { cookie: 'tema=dark; comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(prisma.session.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 1 },
                data: { lastUsedAt: expect.any(Date) }
            }));
            expect(req.user).toEqual(expect.objectContaining({ userId: 'user-1', role: 'UsuÃ¡rio PadrÃ£o' }));
            expect(req.session).toEqual(expect.objectContaining({ id: 1, tokenHash: expect.any(String) }));
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('retorna 401 quando ocorre erro inesperado na validacao', async () => {
            prisma.session.findFirst.mockRejectedValue(new Error('db off'));
            const req = { headers: { cookie: 'comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('rbacMiddleware', () => {
        it('bloqueia usuario sem role permitida', () => {
            const req = { user: { role: 'UsuÃ¡rio PadrÃ£o' } };
            const res = makeRes();
            const next = jest.fn();
            const middleware = rbacMiddleware.requireRole('Administrador');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });

        it('permite usuario com role autorizada', () => {
            const req = { user: { role: 'Administrador' } };
            const res = makeRes();
            const next = jest.fn();
            const middleware = rbacMiddleware.requireRole('Administrador');

            middleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });
    });

    describe('loginRateLimiter', () => {
        it('bloqueia a sexta tentativa apos cinco falhas de login no mesmo IP', () => {
            const ip = '198.51.100.10';

            for (let attempt = 0; attempt < loginRateLimiter.LOGIN_FAILURE_LIMIT; attempt += 1) {
                const req = { ip, socket: {} };
                const res = makeRes();
                const next = jest.fn();

                loginRateLimiter.loginRateLimiter(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);

                res.statusCode = 401;
                res.finishCallback();
            }

            const blockedReq = { ip, socket: {} };
            const blockedRes = makeRes();
            const blockedNext = jest.fn();

            loginRateLimiter.loginRateLimiter(blockedReq, blockedRes, blockedNext);

            expect(blockedRes.status).toHaveBeenCalledWith(429);
            expect(blockedRes.json).toHaveBeenCalledWith({
                error: loginRateLimiter.RATE_LIMIT_MESSAGE,
                code: 'LOGIN_RATE_LIMITED'
            });
            expect(blockedNext).not.toHaveBeenCalled();
        });

        it('zera tentativas falhas quando o login posterior e bem-sucedido', () => {
            const ip = '198.51.100.11';
            const failedReq = { ip, socket: {} };
            const failedRes = makeRes();

            loginRateLimiter.loginRateLimiter(failedReq, failedRes, jest.fn());
            failedRes.statusCode = 401;
            failedRes.finishCallback();

            const successReq = { ip, socket: {} };
            const successRes = makeRes();

            loginRateLimiter.loginRateLimiter(successReq, successRes, jest.fn());
            successRes.statusCode = 200;
            successRes.finishCallback();

            const nextReq = { ip, socket: {} };
            const nextRes = makeRes();
            const next = jest.fn();

            loginRateLimiter.loginRateLimiter(nextReq, nextRes, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(nextRes.status).not.toHaveBeenCalledWith(429);
        });
    });

    describe('errorHandler', () => {
        it('retorna erro padronizado sem expor stack trace para erro inesperado', () => {
            const res = makeRes();
            const error = new Error('falha tecnica sensivel');

            errorHandler(error, {}, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Erro interno do servidor.',
                code: 'INTERNAL_SERVER_ERROR'
            });
            expect(console.error).toHaveBeenCalled();
        });

        it('preserva mensagem amigavel e codigo de erros 4XX', () => {
            const res = makeRes();
            const error = new Error('Entrada invalida.');
            error.status = 400;
            error.code = 'BAD_REQUEST';

            errorHandler(error, {}, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Entrada invalida.',
                code: 'BAD_REQUEST'
            });
        });
    });
});
