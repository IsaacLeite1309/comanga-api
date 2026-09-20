import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../prisma';
import structuredLogger from '../../infrastructure/logging/structuredLogger';
import { birthDateSchema, parseBirthDate, passwordSchema } from './accountRules';
import { hashSessionToken, setSessionCookie, clearSessionCookie } from './session';

interface AuthNotifications {
    sendActivationEmail(input: { toEmail: string; username: string; token: string }): Promise<void>;
}

interface PrismaKnownError {
    code?: string;
    meta?: { target?: unknown };
}

function getUniqueConflictField(error: PrismaKnownError): 'email' | 'username' | undefined {
    if (error.code !== 'P2002') return undefined;
    const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(' ')
        : String(error.meta?.target || '');
    if (target.includes('email')) return 'email';
    if (target.includes('username')) return 'username';
    return undefined;
}

function sendRegistrationConflict(res: Response, field: 'email' | 'username') {
    if (field === 'email') {
        return res.status(409).json({
            error: 'Este endereço de e-mail já está em uso. Tente fazer login ou recuperar sua senha.',
            field
        });
    }
    return res.status(409).json({
        error: 'Este nome de usuário não está disponível. Por favor, escolha outro.',
        field
    });
}

const registerSchema = z.object({
    username: z.string()
        .regex(/^[a-zA-Z0-9_]{3,20}$/, 'Utilize entre 3 e 20 caracteres, sem espaços, acentos ou caracteres especiais.'),
    email: z.string().email('E-mail com formato inválido.'),
    birthDate: birthDateSchema,
    password: passwordSchema,
    confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
    message: 'Divergência nos valores da senha e confirmação de senha!',
    path: ['confirmPassword']
});

function createRegisterUserHandler(notifications: AuthNotifications) {
    return async function registerUser(req: Request, res: Response, next: NextFunction) {
        try {
            const validation = registerSchema.safeParse(req.body);
            if (!validation.success) {
                const issue = validation.error.issues[0];
                return res.status(400).json({
                    error: issue?.message || 'Dados inválidos.',
                    field: issue?.path[0] || 'geral'
                });
            }

            const { username, email, password, birthDate } = validation.data;
            const conflict = await prisma.user.findFirst({
                where: { OR: [{ email }, { username }] },
                select: { email: true, username: true }
            });
            if (conflict?.email === email) return sendRegistrationConflict(res, 'email');
            if (conflict?.username === username) return sendRegistrationConflict(res, 'username');

            const passwordHash = await bcrypt.hash(password, 10);
            const activationToken = crypto.randomBytes(32).toString('hex');
            await prisma.user.create({
                data: {
                    username,
                    email,
                    passwordHash,
                    birthDate: parseBirthDate(birthDate),
                    activationToken,
                    activationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
                }
            });

            try {
                await notifications.sendActivationEmail({ toEmail: email, username, token: activationToken });
            } catch {
                structuredLogger.error('email.activation_failed');
                return res.status(201).json({
                    message: 'Conta criada, mas não foi possível enviar o e-mail de ativação. Use a opção de reenvio.',
                    email_sent: false
                });
            }
            return res.status(201).json({ message: 'Conta criada com sucesso! Enviamos o e-mail de ativação.' });
        } catch (error) {
            const conflictField = getUniqueConflictField(error as PrismaKnownError);
            if (conflictField) return sendRegistrationConflict(res, conflictField);
            return next(error);
        }
    };
}

async function activateAccount(req: Request, res: Response, next: NextFunction) {
    const token = String(req.params.token);
    try {
        const activationResult = await prisma.$transaction(async (tx) => {
            const now = new Date();
            const user = await tx.user.findFirst({
                where: { activationToken: token, status: 'Pendente' },
                select: { id: true, activationExpiresAt: true }
            });
            if (!user) return { error: 'Link de ativação inválido!' };
            if (!user.activationExpiresAt || now > user.activationExpiresAt) {
                return { error: 'Este link de ativação expirou. Solicite um novo e-mail de ativação.' };
            }
            const updateResult = await tx.user.updateMany({
                where: {
                    id: user.id,
                    status: 'Pendente',
                    activationToken: token,
                    activationExpiresAt: { gt: now }
                },
                data: { status: 'Ativada', activationToken: null, activationExpiresAt: null }
            });
            return updateResult.count === 1
                ? { activated: true }
                : { error: 'Link de ativação inválido!' };
        });
        if ('error' in activationResult) return res.status(400).json({ error: activationResult.error });
        return res.status(200).json({ message: 'Conta ativada com sucesso!' });
    } catch (error) {
        return next(error);
    }
}

function createResendActivationHandler(notifications: AuthNotifications) {
    return async function resendActivation(req: Request, res: Response, next: NextFunction) {
        const { email } = req.body as { email?: string };
        if (!email) return res.status(400).json({ error: 'O e-mail é obrigatório.' });
        try {
            const user = await prisma.user.findUnique({
                where: { email },
                select: { id: true, username: true, status: true }
            });
            if (!user) return res.status(404).json({ error: 'Endereço de e-mail não cadastrado' });
            if (user.status === 'Ativada') {
                return res.status(400).json({ error: 'Este endereço de e-mail pertence a uma conta ativada.' });
            }
            if (user.status !== 'Pendente') {
                return res.status(400).json({ error: 'Somente contas pendentes podem solicitar um novo link de ativação.' });
            }

            const newActivationToken = crypto.randomBytes(32).toString('hex');
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    activationToken: newActivationToken,
                    activationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
                }
            });
            try {
                await notifications.sendActivationEmail({
                    toEmail: email,
                    username: user.username,
                    token: newActivationToken
                });
            } catch {
                structuredLogger.error('email.activation_failed');
                return res.status(502).json({
                    error: 'Erro ao tentar enviar o e-mail.',
                    code: 'ACTIVATION_EMAIL_DELIVERY_FAILED'
                });
            }
            return res.status(200).json({ message: 'Novo link de ativação enviado com sucesso para o seu e-mail!' });
        } catch (error) {
            return next(error);
        }
    };
}

async function loginUser(req: Request, res: Response, next: NextFunction) {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, username: true, passwordHash: true, status: true, nivelAcesso: true }
        });
        if (!user || !await bcrypt.compare(password, user.passwordHash)) {
            return res.status(401).json({ error: 'Credenciais inválidas!' });
        }
        if (user.status === 'Pendente') {
            return res.status(403).json({
                error: 'Conta de acesso pendente. Ative a conta com o e-mail de verificação enviado anteriormente.'
            });
        }
        if (user.status === 'Bloqueada') {
            return res.status(403).json({ error: 'Esta conta foi bloqueada por razões de segurança.' });
        }

        const sessionToken = crypto.randomBytes(48).toString('hex');
        const sessionTokenHash = hashSessionToken(sessionToken);
        const created = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
            const current = await tx.user.findUnique({
                where: { id: user.id },
                select: { passwordHash: true, status: true }
            });
            if (!current || current.passwordHash !== user.passwordHash || current.status !== 'Ativada') return false;
            await tx.session.create({ data: { userId: user.id, sessionTokenHash } });
            return true;
        });
        if (!created) return res.status(401).json({ error: 'Credenciais inválidas!' });

        setSessionCookie(req, res, sessionToken);
        return res.status(200).json({
            message: 'Login realizado com sucesso!',
            user: { id: String(user.id), username: user.username, role: user.nivelAcesso }
        });
    } catch (error) {
        return next(error);
    }
}

async function logoutUser(req: Request, res: Response, next: NextFunction) {
    try {
        if (!req.session) throw new Error('Sessao autenticada nao encontrada na requisicao.');
        await prisma.session.updateMany({
            where: { id: req.session.id, revokedAt: null },
            data: { revokedAt: new Date() }
        });
        clearSessionCookie(req, res);
        return res.status(200).json({ message: 'Sessão encerrada com sucesso.' });
    } catch (error) {
        return next(error);
    }
}

function createAuthHandlers(notifications: AuthNotifications) {
    return {
        registerUser: createRegisterUserHandler(notifications),
        activateAccount,
        resendActivation: createResendActivationHandler(notifications),
        loginUser,
        logoutUser
    };
}

export { createAuthHandlers };
export type { AuthNotifications };
