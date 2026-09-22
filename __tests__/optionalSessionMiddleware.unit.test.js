const prisma = {
    session: {
        findFirst: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const { optionalSessionMiddleware } = require('../src/modules/auth');

describe('sessão opcional do catálogo público', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('mantém requisição sem cookie como visitante', async () => {
        const req = { headers: {} };
        const next = jest.fn();

        await optionalSessionMiddleware(req, {}, next);

        expect(prisma.session.findFirst).not.toHaveBeenCalled();
        expect(req.publicCatalogViewer).toEqual({ canViewAdultContent: false, hasAdminAssignment: false });
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('mantém cookie inválido e falha de validação como visitante sem retornar erro', async () => {
        prisma.session.findFirst
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce(new Error('database unavailable'));
        const invalidReq = { headers: { cookie: 'comanga_session=invalid' } };
        const failedReq = { headers: { cookie: 'comanga_session=other' } };
        const invalidNext = jest.fn();
        const failedNext = jest.fn();

        await optionalSessionMiddleware(invalidReq, {}, invalidNext);
        await optionalSessionMiddleware(failedReq, {}, failedNext);

        expect(invalidReq.publicCatalogViewer).toEqual({ canViewAdultContent: false, hasAdminAssignment: false });
        expect(failedReq.publicCatalogViewer).toEqual({ canViewAdultContent: false, hasAdminAssignment: false });
        expect(invalidNext).toHaveBeenCalledTimes(1);
        expect(failedNext).toHaveBeenCalledTimes(1);
    });

    it('ignora preferência +18 de conta não ativa', async () => {
        prisma.session.findFirst.mockResolvedValue({
            user: {
                id: 'user-1',
                status: 'Bloqueada',
                birthDate: new Date('2000-01-01'), conteudoAdulto: true,
                userProfiles: [
                    { profile: { code: 'ADMINISTRADOR', name: 'Administrador' } },
                    { profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }
                ]
            }
        });
        const req = { headers: { cookie: 'comanga_session=blocked' } };
        const next = jest.fn();

        await optionalSessionMiddleware(req, {}, next);

        expect(req.publicCatalogViewer).toEqual({ canViewAdultContent: false, hasAdminAssignment: false });
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('reconhece preferência +18 apenas na sessão de conta ativa', async () => {
        prisma.session.findFirst.mockResolvedValue({
            user: {
                id: 'user-2',
                status: 'Ativada',
                birthDate: new Date('2000-01-01'), conteudoAdulto: true,
                userProfiles: [{ profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }]
            }
        });
        const req = { headers: { cookie: 'tema=dark; comanga_session=valid-token' } };
        const next = jest.fn();

        await optionalSessionMiddleware(req, {}, next);

        expect(prisma.session.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                sessionTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                revokedAt: null
            }
        }));
        expect(req.publicCatalogViewer).toEqual({
            userId: 'user-2',
            canViewAdultContent: true,
            hasAdminAssignment: false
        });
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('expõe a atribuição administrativa vigente mesmo com o perfil padrão ativo', async () => {
        prisma.session.findFirst.mockResolvedValue({
            user: {
                id: 'user-3',
                status: 'Ativada',
                birthDate: null,
                conteudoAdulto: false,
                userProfiles: [
                    { profile: { code: 'ADMINISTRADOR', name: 'Administrador' } },
                    { profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }
                ]
            }
        });
        const req = { headers: { cookie: 'comanga_session=admin-token' } };
        const next = jest.fn();

        await optionalSessionMiddleware(req, {}, next);

        expect(req.publicCatalogViewer).toEqual({
            userId: 'user-3',
            canViewAdultContent: false,
            hasAdminAssignment: true
        });
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('marca a atribuição administrativa mesmo sem preferência +18 nem idade comprovada', async () => {
        prisma.session.findFirst.mockResolvedValue({
            user: {
                id: 'user-3',
                status: 'Ativada',
                birthDate: null,
                conteudoAdulto: false,
                userProfiles: [
                    { profile: { code: 'ADMINISTRADOR', name: 'Administrador' } },
                    { profile: { code: 'USUARIO_PADRAO', name: 'Usuário Padrão' } }
                ]
            }
        });
        const req = { headers: { cookie: 'comanga_session=admin-token' } };
        const next = jest.fn();

        await optionalSessionMiddleware(req, {}, next);

        expect(req.publicCatalogViewer).toEqual({
            userId: 'user-3',
            canViewAdultContent: false,
            hasAdminAssignment: true
        });
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('não concede atribuição administrativa a menor de idade sem o papel', async () => {
        const birthDate = new Date();
        birthDate.setFullYear(birthDate.getFullYear() - 17);
        prisma.session.findFirst.mockResolvedValue({
            user: {
                id: 'user-4',
                status: 'Ativada',
                birthDate,
                conteudoAdulto: true,
                nivelAcesso: 'Usuário Padrão'
            }
        });
        const req = { headers: { cookie: 'comanga_session=minor-token' } };
        const next = jest.fn();

        await optionalSessionMiddleware(req, {}, next);

        expect(req.publicCatalogViewer).toEqual({
            userId: 'user-4',
            canViewAdultContent: false,
            hasAdminAssignment: false
        });
    });
});
