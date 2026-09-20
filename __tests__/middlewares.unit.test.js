const prisma = {
    session: {
        findFirst: jest.fn(),
        updateMany: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const { authMiddleware, requireRole } = require('../src/modules/auth');
const { defaultLimiter, LOGIN_FAILURE_LIMIT, RATE_LIMIT_MESSAGE } = require('../src/modules/auth/loginRateLimiter');
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
        defaultLimiter.reset();
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
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Pendente',
                    userProfiles: [{ profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }]
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
                lastUsedAt: new Date(0),
                user: {
                    id: 'user-1',
                    username: 'isaac',
                    email: 'user@teste.local',
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada',
                    userProfiles: [{ profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }]
                }
            });
            prisma.session.updateMany.mockResolvedValue({ count: 1 });
            const req = { headers: { cookie: 'tema=dark; comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(prisma.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ id: 1 }),
                data: { lastUsedAt: expect.any(Date) }
            }));
            expect(req.user).toEqual(expect.objectContaining({
                userId: 'user-1',
                role: 'Usuário Padrão',
                activeProfile: 'Usuário Padrão',
                profiles: ['Usuário Padrão'],
                hasAdminAssignment: false
            }));
            expect(req.session).toEqual(expect.objectContaining({ id: 1, tokenHash: expect.any(String) }));
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('rebaixa o perfil ativo quando a conta perdeu a atribuicao administrativa', async () => {
            prisma.session.findFirst.mockResolvedValue({
                id: 7,
                lastUsedAt: new Date(),
                activeProfile: { code: 'ADMINISTRADOR', name: 'Administrador' },
                user: {
                    id: 'user-1',
                    username: 'isaac',
                    email: 'user@teste.local',
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada',
                    userProfiles: [{ profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }]
                }
            });
            const req = { headers: { cookie: 'comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(req.user).toEqual(expect.objectContaining({
                activeProfile: 'Usuário Padrão',
                profiles: ['Usuário Padrão'],
                hasAdminAssignment: false
            }));
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('mantem o perfil ativo administrador quando a atribuicao continua vigente', async () => {
            prisma.session.findFirst.mockResolvedValue({
                id: 8,
                lastUsedAt: new Date(),
                activeProfile: { code: 'ADMINISTRADOR', name: 'Administrador' },
                user: {
                    id: 'user-1',
                    username: 'isaac',
                    email: 'user@teste.local',
                    nivelAcesso: 'Administrador',
                    status: 'Ativada',
                    userProfiles: [
                        { profile: { code: 'ADMINISTRADOR', name: 'Administrador' } },
                        { profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }
                    ]
                }
            });
            const req = { headers: { cookie: 'comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(req.user).toEqual(expect.objectContaining({
                role: 'Administrador',
                activeProfile: 'Administrador',
                profiles: ['Administrador', 'Usuário Padrão'],
                hasAdminAssignment: true
            }));
        });

        it('nao regrava lastUsedAt quando a sessao foi usada recentemente', async () => {
            prisma.session.findFirst.mockResolvedValue({
                id: 1,
                lastUsedAt: new Date(),
                user: {
                    id: 'user-1',
                    username: 'isaac',
                    email: 'user@teste.local',
                    nivelAcesso: 'Administrador',
                    status: 'Ativada',
                    userProfiles: [
                        { profile: { code: 'ADMINISTRADOR', name: 'Administrador' } },
                        { profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }
                    ]
                }
            });
            const req = { headers: { cookie: 'comanga_session=abc123' } };
            const res = makeRes();
            const next = jest.fn();

            await authMiddleware(req, res, next);

            expect(prisma.session.updateMany).not.toHaveBeenCalled();
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
        it('bloqueia perfil ativo sem permissao mesmo com atribuicao administrativa', () => {
            const req = {
                user: {
                    role: 'Usuário Padrão',
                    activeProfile: 'Usuário Padrão',
                    profiles: ['Administrador', 'Usuário Padrão']
                }
            };
            const res = makeRes();
            const next = jest.fn();
            const middleware = requireRole('Administrador');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });

        it('bloqueia perfil ativo administrador sem atribuicao vigente na conta', () => {
            const req = {
                user: {
                    role: 'Administrador',
                    activeProfile: 'Administrador',
                    profiles: ['Usuário Padrão']
                }
            };
            const res = makeRes();
            const next = jest.fn();
            const middleware = requireRole('Administrador');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });

        it('bloqueia requisicao sem usuario autenticado', () => {
            const res = makeRes();
            const next = jest.fn();

            requireRole('Administrador')({}, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });

        it('permite perfil ativo administrador com atribuicao vigente', () => {
            const req = {
                user: {
                    role: 'Administrador',
                    activeProfile: 'Administrador',
                    profiles: ['Administrador', 'Usuário Padrão']
                }
            };
            const res = makeRes();
            const next = jest.fn();
            const middleware = requireRole('Administrador');

            middleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        });
    });

    describe('loginRateLimiter', () => {
        it('bloqueia a sexta tentativa apos cinco falhas de login no mesmo IP', () => {
            const ip = '198.51.100.10';

            for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
                const req = { ip, socket: {} };
                const res = makeRes();
                const next = jest.fn();

                defaultLimiter.middleware(req, res, next);
                expect(next).toHaveBeenCalledTimes(1);

                res.statusCode = 401;
                res.finishCallback();
            }

            const blockedReq = { ip, socket: {} };
            const blockedRes = makeRes();
            const blockedNext = jest.fn();

            defaultLimiter.middleware(blockedReq, blockedRes, blockedNext);

            expect(blockedRes.status).toHaveBeenCalledWith(429);
            expect(blockedRes.json).toHaveBeenCalledWith({
                error: RATE_LIMIT_MESSAGE,
                code: 'LOGIN_RATE_LIMITED'
            });
            expect(blockedNext).not.toHaveBeenCalled();
        });

        it('zera tentativas falhas quando o login posterior e bem-sucedido', () => {
            const ip = '198.51.100.11';
            const failedReq = { ip, socket: {} };
            const failedRes = makeRes();

            defaultLimiter.middleware(failedReq, failedRes, jest.fn());
            failedRes.statusCode = 401;
            failedRes.finishCallback();

            const successReq = { ip, socket: {} };
            const successRes = makeRes();

            defaultLimiter.middleware(successReq, successRes, jest.fn());
            successRes.statusCode = 200;
            successRes.finishCallback();

            const nextReq = { ip, socket: {} };
            const nextRes = makeRes();
            const next = jest.fn();

            defaultLimiter.middleware(nextReq, nextRes, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(nextRes.status).not.toHaveBeenCalledWith(429);
        });
    });

    describe('errorHandler', () => {
        it('retorna erro padronizado sem expor stack trace para erro inesperado', () => {
            const res = makeRes();
            const error = new Error('falha tecnica sensivel');
            const req = {
                method: 'GET',
                originalUrl: '/api/admin/works',
                requestId: 'req-test-123'
            };

            errorHandler(error, req, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Erro interno do servidor.',
                code: 'INTERNAL_SERVER_ERROR'
            });
            expect(console.error).toHaveBeenCalledTimes(1);
            const loggedError = JSON.parse(console.error.mock.calls[0][0]);
            expect(loggedError).toEqual(expect.objectContaining({
                level: 'error',
                event: 'api.unhandled_error',
                method: 'GET',
                route: '[unmatched]',
                requestId: 'req-test-123',
                timestamp: expect.any(String),
                error: expect.objectContaining({
                    name: 'Error',
                    message: 'falha tecnica sensivel'
                })
            }));
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
