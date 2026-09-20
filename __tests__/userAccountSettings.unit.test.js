const prisma = {
    user: {
        findUnique: jest.fn(),
        update: jest.fn()
    },
    session: {
        updateMany: jest.fn()
    },
    profile: {
        findUnique: jest.fn()
    },
    userProfile: {
        findMany: jest.fn(),
        findUnique: jest.fn()
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn()
};

jest.mock('../src/prisma', () => prisma);

const users = require('../src/modules/users');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };

    return res;
}

function makeReq(overrides = {}) {
    return {
        body: {},
        params: {},
        user: { userId: 'user-1', profiles: ['Usuário Padrão'], activeProfile: 'Usuário Padrão' },
        session: { id: 10, tokenHash: 'hash' },
        ...overrides
    };
}

describe('ajustes da própria conta (unitário)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.$transaction.mockImplementation(callback => callback(prisma));
        prisma.profile.findUnique.mockResolvedValue({ id: 1, code: 'USUARIO_PADRAO', name: 'Usuário Padrão' });
        prisma.userProfile.findUnique.mockResolvedValue({ profileId: 1 });
        prisma.userProfile.findMany.mockResolvedValue([{ profile: { name: 'Usuário Padrão' } }]);
        prisma.session.updateMany.mockResolvedValue({ count: 1 });
        prisma.user.update.mockResolvedValue({});
    });

    describe('updateActiveProfile', () => {
        it('exige sessão autenticada na requisição', async () => {
            const req = makeReq({ body: { profile: 'Usuário Padrão' }, session: undefined });
            const next = jest.fn();

            await users.updateActiveProfile(req, makeRes(), next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });

        it('exige usuário autenticado na requisição', async () => {
            const req = makeReq({ body: { profile: 'Usuário Padrão' }, user: undefined });
            const next = jest.fn();

            await users.updateActiveProfile(req, makeRes(), next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });

        it('recusa corpo sem o campo profile', async () => {
            const res = makeRes();

            await users.updateActiveProfile(makeReq({ body: {} }), res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it('retorna 404 quando a conta desaparece entre a troca e a leitura', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const res = makeRes();

            await users.updateActiveProfile(makeReq({ body: { profile: 'Usuário Padrão' } }), res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('encaminha falha inesperada ao handler global', async () => {
            const error = new Error('banco indisponível');
            prisma.$transaction.mockRejectedValue(error);
            const next = jest.fn();

            await users.updateActiveProfile(makeReq({ body: { profile: 'Usuário Padrão' } }), makeRes(), next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('updateOwnUsername', () => {
        it('traduz conflito UNIQUE concorrente para 409', async () => {
            prisma.user.update.mockRejectedValue({ code: 'P2002' });
            const res = makeRes();

            await users.updateOwnUsername(makeReq({ body: { username: 'novo_nome' } }), res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ field: 'username' }));
        });

        it('traduz registro ausente para 404', async () => {
            prisma.user.update.mockRejectedValue({ code: 'P2025' });
            const res = makeRes();

            await users.updateOwnUsername(makeReq({ body: { username: 'novo_nome' } }), res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('retorna 404 quando a conta some antes de montar a resposta', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const res = makeRes();

            await users.updateOwnUsername(makeReq({ body: { username: 'novo_nome' } }), res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('encaminha falha inesperada ao handler global', async () => {
            const error = new Error('falha inesperada');
            prisma.user.update.mockRejectedValue(error);
            const next = jest.fn();

            await users.updateOwnUsername(makeReq({ body: { username: 'novo_nome' } }), makeRes(), next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('updateOwnPassword', () => {
        const validBody = {
            currentPassword: 'SenhaForte123!',
            newPassword: 'OutraSenha456@',
            confirmPassword: 'OutraSenha456@'
        };

        it('retorna 404 quando a conta autenticada não existe mais', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const res = makeRes();

            await users.updateOwnPassword(makeReq({ body: validBody }), res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(404);
            expect(prisma.session.updateMany).not.toHaveBeenCalled();
        });

        it('encaminha falha transacional sem alterar senha nem sessões', async () => {
            const error = new Error('transação abortada');
            prisma.$transaction.mockRejectedValue(error);
            const next = jest.fn();

            await users.updateOwnPassword(makeReq({ body: validBody }), makeRes(), next);

            expect(next).toHaveBeenCalledWith(error);
            expect(prisma.user.update).not.toHaveBeenCalled();
            expect(prisma.session.updateMany).not.toHaveBeenCalled();
        });
    });
});
