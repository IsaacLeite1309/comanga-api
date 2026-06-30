const prisma = {
    session: {
        findFirst: jest.fn(),
        update: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const authMiddleware = require('../src/middlewares/authMiddleware');
const rbacMiddleware = require('../src/middlewares/rbacMiddleware');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };

    return res;
}

describe('middlewares unitarios', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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
});
