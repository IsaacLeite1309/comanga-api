const prisma = {
    user: {
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn()
    },
    $transaction: jest.fn()
};

jest.mock('../src/prisma', () => prisma);

const adminController = require('../src/controllers/adminController');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };

    return res;
}

function makeReq(overrides = {}) {
    return {
        query: {},
        params: {},
        body: {},
        user: { userId: 'admin-1', role: 'Administrador' },
        ...overrides
    };
}

describe('adminController unitario', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
    });

    describe('listUsers', () => {
        it('lista usuarios com filtros combinados, ordenacao desc e paginacao', async () => {
            const users = [
                {
                    id: 'user-2',
                    username: 'zeta',
                    email: 'zeta@teste.local',
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada'
                }
            ];
            prisma.$transaction.mockResolvedValue([users, 1]);
            const req = makeReq({
                query: {
                    term: 'zet',
                    role: 'Usuário Padrão',
                    status: 'Ativada',
                    order: 'DESC',
                    page: '2',
                    limit: '5'
                }
            });
            const res = makeRes();

            await adminController.listUsers(req, res);

            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    OR: expect.any(Array),
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada'
                }),
                orderBy: { username: 'desc' },
                skip: 5,
                take: 5
            }));
            expect(prisma.user.count).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada'
                })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                users: [
                    {
                        id: 'user-2',
                        username: 'zeta',
                        email: 'zeta@teste.local',
                        role: 'Usuário Padrão',
                        status: 'Ativada'
                    }
                ],
                pagination: {
                    page: 2,
                    limit: 5,
                    total: 1,
                    totalPages: 1
                }
            });
        });

        it('rejeita filtros invalidos', async () => {
            const req = makeReq({ query: { order: 'INVALIDO' } });
            const res = makeRes();

            await adminController.listUsers(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.user.findMany).not.toHaveBeenCalled();
        });
    });

    describe('updateUserRole', () => {
        it('atualiza nivel de acesso de outro usuario', async () => {
            prisma.user.update.mockResolvedValue({
                id: 'user-2',
                username: 'maria',
                email: 'maria@teste.local',
                nivelAcesso: 'Administrador',
                status: 'Ativada'
            });
            const req = makeReq({
                params: { id: 'user-2' },
                body: { role: 'Administrador' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'user-2' },
                data: { nivelAcesso: 'Administrador' }
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                user: {
                    id: 'user-2',
                    username: 'maria',
                    email: 'maria@teste.local',
                    role: 'Administrador',
                    status: 'Ativada'
                }
            });
        });

        it('bloqueia automodificacao do administrador autenticado', async () => {
            const req = makeReq({
                params: { id: 'admin-1' },
                body: { role: 'Usuário Padrão' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Você não pode alterar o nível de acesso de sua própria conta!'
            });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('rejeita nivel de acesso invalido', async () => {
            const req = makeReq({
                params: { id: 'user-2' },
                body: { role: 'Dono' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('retorna 404 quando usuario alvo nao existe', async () => {
            prisma.user.update.mockRejectedValue({ code: 'P2025' });
            const req = makeReq({
                params: { id: 'user-2' },
                body: { role: 'Administrador' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });
});
