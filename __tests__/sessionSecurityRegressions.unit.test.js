const prisma = {
    session: {
        findFirst: jest.fn(),
        updateMany: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const crypto = require('node:crypto');
const { authMiddleware, requireRole } = require('../src/modules/auth');

const ACTIVE_USER = {
    id: 'user-1',
    username: 'isaac',
    email: 'user@teste.local',
    nivelAcesso: 'Usuário Padrão',
    status: 'Ativada'
};

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };
    return res;
}

function sessionCookie(token) {
    return { headers: { cookie: `comanga_session=${token}` } };
}

describe('regressões de segurança da sessão autenticada', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.SESSION_TOUCH_INTERVAL_MS;
    });

    afterAll(() => {
        delete process.env.SESSION_TOUCH_INTERVAL_MS;
    });

    it('procura a sessão pelo hash SHA-256 do cookie e descarta sessões revogadas', async () => {
        prisma.session.findFirst.mockResolvedValue(null);
        const token = 'a'.repeat(96);
        const res = makeRes();

        await authMiddleware(sessionCookie(token), res, jest.fn());

        const [{ where }] = prisma.session.findFirst.mock.calls[0];
        expect(where).toEqual({
            sessionTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
            revokedAt: null
        });
        // O token em claro nunca pode servir de chave de busca nem viajar para o banco.
        expect(JSON.stringify(prisma.session.findFirst.mock.calls[0])).not.toContain(token);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it.each([
        ['Pendente'],
        ['Bloqueada'],
        ['Desativada']
    ])('recusa com 403 a sessão de conta com status %s sem liberar a requisição', async (status) => {
        prisma.session.findFirst.mockResolvedValue({
            id: 7,
            lastUsedAt: new Date(0),
            user: { ...ACTIVE_USER, status }
        });
        const req = sessionCookie('token-status');
        const res = makeRes();
        const next = jest.fn();

        await authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
        expect(req.user).toBeUndefined();
        expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('condiciona a gravação de lastUsedAt à própria linha ainda estar desatualizada', async () => {
        prisma.session.findFirst.mockResolvedValue({
            id: 42,
            lastUsedAt: new Date(Date.now() - 60 * 60 * 1000),
            user: ACTIVE_USER
        });
        prisma.session.updateMany.mockResolvedValue({ count: 1 });

        await authMiddleware(sessionCookie('token-touch'), makeRes(), jest.fn());

        const [{ where, data }] = prisma.session.updateMany.mock.calls[0];
        // Sem a comparação na cláusula where, duas requisições simultâneas regravam a mesma linha.
        expect(where.id).toBe(42);
        expect(where.lastUsedAt.lt).toBeInstanceOf(Date);
        expect(where.lastUsedAt.lt.getTime()).toBeLessThanOrEqual(data.lastUsedAt.getTime());
    });

    it('registra o primeiro uso de uma sessão que nunca foi tocada', async () => {
        prisma.session.findFirst.mockResolvedValue({
            id: 43,
            lastUsedAt: null,
            user: ACTIVE_USER
        });
        prisma.session.updateMany.mockResolvedValue({ count: 1 });
        const next = jest.fn();

        await authMiddleware(sessionCookie('token-first-use'), makeRes(), next);

        expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('respeita o intervalo configurado de toque em vez de um valor fixo no código', async () => {
        prisma.session.findFirst.mockResolvedValue({
            id: 44,
            lastUsedAt: new Date(Date.now() - 1000),
            user: ACTIVE_USER
        });
        prisma.session.updateMany.mockResolvedValue({ count: 1 });

        await authMiddleware(sessionCookie('token-interval'), makeRes(), jest.fn());
        expect(prisma.session.updateMany).not.toHaveBeenCalled();

        process.env.SESSION_TOUCH_INTERVAL_MS = '0';
        await authMiddleware(sessionCookie('token-interval'), makeRes(), jest.fn());
        expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['tema=dark'],
        ['comanga_session'],
        ['comanga_session=%E0%A4%A'],
        ['outro_cookie=comanga_session=abc']
    ])('trata o cabeçalho de cookie %s como ausência de sessão sem consultar o banco', async (cookie) => {
        const req = { headers: { cookie } };
        const res = makeRes();
        const next = jest.fn();

        await authMiddleware(req, res, next);

        expect(prisma.session.findFirst).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('não devolve detalhes internos quando a validação da sessão falha no banco', async () => {
        prisma.session.findFirst.mockRejectedValue(new Error('relation "sessions" does not exist'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = makeRes();

        await authMiddleware(sessionCookie('token-db-off'), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.'
        });
        console.error.mockRestore();
    });
});

describe('regressões de autorização por perfil', () => {
    it.each([
        ['requisição sem usuário autenticado', {}],
        ['usuário sem perfil resolvido', { user: {} }],
        ['perfil vazio', { user: { role: '' } }],
        ['perfil desconhecido', { user: { role: 'Moderador' } }],
        ['perfil enviado como objeto', { user: { role: { toString: () => 'Administrador' } } }]
    ])('recusa %s em rota administrativa', (_descricao, req) => {
        const res = makeRes();
        const next = jest.fn();

        requireRole('Administrador')(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('autoriza somente os perfis declarados na própria rota', () => {
        const permitidos = requireRole('Administrador', 'Curador');

        for (const role of ['Administrador', 'Curador']) {
            const res = makeRes();
            const next = jest.fn();
            permitidos({ user: { role, activeProfile: role, profiles: [role] } }, res, next);
            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
        }

        const res = makeRes();
        requireRole('Curador')({ user: { role: 'Administrador', activeProfile: 'Administrador', profiles: ['Administrador'] } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
