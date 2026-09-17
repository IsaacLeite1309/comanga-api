const bcrypt = require('bcrypt');
const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordResetToken: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    session: { updateMany: jest.fn() },
    $queryRaw: jest.fn(), $transaction: jest.fn()
};
const sendPasswordResetEmail = jest.fn();
jest.mock('../src/prisma', () => prisma);
jest.mock('../src/infrastructure/container', () => ({ authNotificationService: { sendPasswordResetEmail } }));
jest.mock('../src/infrastructure/logging/structuredLogger', () => ({ error: jest.fn() }));
const { requestPasswordReset, resetPassword, RECOVERY_MESSAGE } = require('../src/modules/auth/passwordRecovery');
const { createRecoveryRateLimiter } = require('../src/middlewares/recoveryRateLimiter');
const makeRes = () => { const res = { status: jest.fn(() => res), json: jest.fn(() => res), setHeader: jest.fn() }; return res; };
const input = { token: 'a'.repeat(64), password: 'SenhaNova123!', confirmPassword: 'SenhaNova123!' };

beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(callback => callback(prisma));
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
});

describe('recuperação neutra', () => {
    it('responde antes da consulta e não deixa a latência do provedor revelar a conta', async () => {
        let finish;
        prisma.$transaction.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const res = makeRes();
        const pending = requestPasswordReset({ body: { email: 'a@b.com' } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: RECOVERY_MESSAGE });
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
        finish(null); await pending;
    });
    it('rejeita e-mail inválido sem banco', async () => {
        const res = makeRes(); await requestPasswordReset({ body: { email: 'x' } }, res);
        expect(res.status).toHaveBeenCalledWith(400); expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it.each([null, 'Pendente', 'Bloqueada', 'Ativada'])('mantém a resposta para status %s', async status => {
        prisma.user.findUnique.mockResolvedValue(status ? { id: 'id', email: 'a@b.com', username: 'a', status } : null);
        const res = makeRes(); await requestPasswordReset({ body: { email: 'a@b.com' } }, res);
        expect(res.json).toHaveBeenCalledWith({ message: RECOVERY_MESSAGE });
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(status === 'Ativada' ? 1 : 0);
        expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(status === 'Ativada' ? 1 : 0);
        if (status === 'Ativada') {
            const raw = sendPasswordResetEmail.mock.calls[0][0].token;
            const data = prisma.passwordResetToken.create.mock.calls[0][0].data;
            expect(raw).toMatch(/^[a-f0-9]{64}$/); expect(data.tokenHash).not.toBe(raw);
            expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(3590000);
            expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'id', usedAt: null } }));
        }
    });
    it.each(['mail', 'db'])('preserva resposta neutra com erro de %s', async source => {
        prisma.user.findUnique.mockResolvedValue({ id: 'id', status: 'Ativada' });
        if (source === 'mail') sendPasswordResetEmail.mockRejectedValue(new Error('secret'));
        else prisma.$transaction.mockRejectedValue(new Error('secret'));
        const res = makeRes(); await requestPasswordReset({ body: { email: 'a@b.com' } }, res);
        expect(res.status).toHaveBeenCalledWith(200); expect(res.json).toHaveBeenCalledWith({ message: RECOVERY_MESSAGE });
    });
    it.each([59_999, 60_000])('respeita o intervalo de emissão em %s ms', async elapsed => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date('2026-09-09T12:00:00Z'));
            const createdAt = new Date(Date.now() - elapsed);
            prisma.user.findUnique.mockResolvedValue({ id: 'id', status: 'Ativada' });
            prisma.passwordResetToken.findFirst.mockImplementation(({ where }) => {
                expect(where).toEqual({ userId: 'id', createdAt: { gt: new Date(Date.now() - 60_000) } });
                return Promise.resolve(createdAt > where.createdAt.gt ? { id: 'recent' } : null);
            });
            await requestPasswordReset({ body: { email: 'a@b.com' } }, makeRes());
            expect(sendPasswordResetEmail).toHaveBeenCalledTimes(elapsed < 60_000 ? 0 : 1);
        } finally { jest.useRealTimers(); }
    });
    it('preserva token e resposta neutra durante o intervalo por conta', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: 'id', status: 'Ativada' });
        prisma.passwordResetToken.findFirst.mockResolvedValue({ id: 'recent' });
        const res = makeRes();
        await requestPasswordReset({ body: { email: 'a@b.com' } }, res);
        expect(res.json).toHaveBeenCalledWith({ message: RECOVERY_MESSAGE });
        expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
        expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });
    it('limita pedidos antes de consultar qualquer conta e libera após 15 minutos', () => {
        let time = 0; const limiter = createRecoveryRateLimiter(() => time); const next = jest.fn(); const res = makeRes();
        for (let i = 0; i < 6; i++) limiter({ ip: '1', socket: {} }, res, next);
        expect(next).toHaveBeenCalledTimes(5); expect(res.status).toHaveBeenCalledWith(429);
        time = 900000; limiter({ ip: '1', socket: {} }, res, next); expect(next).toHaveBeenCalledTimes(6);
    });
});

describe('redefinição de senha', () => {
    it.each([{ ...input, token: '' }, { ...input, password: 'weak' }, { ...input, confirmPassword: 'different' }, ...['A1!' + 'a'.repeat(70), 'Aa1!' + 'é'.repeat(35)].map(password => ({ ...input, password, confirmPassword: password }))])('valida antes de gravar', async body => {
        const res = makeRes(); await resetPassword({ body }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400); expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it.each(['missing', 'used', 'expired', 'blocked', 'race'])('recusa token %s', async kind => {
        const now = new Date();
        prisma.passwordResetToken.findUnique.mockResolvedValue(kind === 'missing' ? null : { id: 't', userId: 'id', user: { status: kind === 'blocked' ? 'Bloqueada' : 'Ativada' }, usedAt: kind === 'used' ? now : null, expiresAt: kind === 'expired' ? now : new Date(Date.now() + 100000) });
        if (kind === 'race') prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
        const res = makeRes(); await resetPassword({ body: input }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400); expect(prisma.user.update).not.toHaveBeenCalled();
    });
    it('grava hash e revoga as sessões na mesma transação', async () => {
        prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 't', userId: 'id', usedAt: null, expiresAt: new Date(Date.now() + 100000), user: { status: 'Ativada' } });
        const res = makeRes(); await resetPassword({ body: input }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(200);
        expect(await bcrypt.compare(input.password, prisma.user.update.mock.calls[0][0].data.passwordHash)).toBe(true);
        expect(prisma.session.updateMany).toHaveBeenCalledWith({ where: { userId: 'id', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    });
    it('não encaminha detalhes secretos de uma falha ao logger global', async () => {
        prisma.$transaction.mockRejectedValue(new Error('token_hash secret')); const next = jest.fn();
        await resetPassword({ body: input }, makeRes(), next);
        expect(next.mock.calls[0][0].message).toBe('Não foi possível redefinir a senha.');
    });
});
