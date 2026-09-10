import bcrypt from 'bcrypt';
import { birthDateSchema, parseBirthDate, isAdult, passwordSchema } from '../modules/auth/accountRules';
import structuredLogger from '../infrastructure/logging/structuredLogger';
import crypto from 'crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { authNotificationService } from '../infrastructure/container';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';
const ACCESS_DENIED_MESSAGE = 'Acesso negado: Você não tem permissão para acessar ou modificar os dados deste perfil.';

interface PrismaKnownError {
    code?: string;
    meta?: {
        target?: unknown;
    };
}

interface UserResponseInput {
    id: string;
    username: string;
    email: string;
    conteudoAdulto: boolean;
    nivelAcesso: string;
}

function hashSessionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function shouldUseSecureCookie(req: Request): boolean {
    if (process.env.COOKIE_SECURE === 'true') return true;
    if (process.env.COOKIE_SECURE === 'false') return false;
    return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
}

function getCookieOptions(req: Request): CookieOptions {
    return {
        httpOnly: true,
        secure: shouldUseSecureCookie(req),
        sameSite: process.env.COOKIE_SAME_SITE as CookieOptions['sameSite'] || 'strict',
        path: '/'
    };
}

function clearSessionCookie(req: Request, res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, getCookieOptions(req));
}

function toUserResponse(user: UserResponseInput) {
    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        conteudo_adulto: user.conteudoAdulto,
        role: user.nivelAcesso
    };
}

function getAuthenticatedUser(req: Request) {
    if (!req.user) {
        throw new Error('Usuario autenticado nao encontrado na requisicao.');
    }

    return req.user;
}

function getAuthenticatedSession(req: Request) {
    if (!req.session) {
        throw new Error('Sessao autenticada nao encontrada na requisicao.');
    }

    return req.session;
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

async function registerUser(req: Request, res: Response, next: NextFunction) {
    try {
        const validation = registerSchema.safeParse(req.body);

        if (!validation.success) {
            const issue = validation.error.issues[0];
            const message = issue?.message || 'Dados inválidos.';
            const fieldName = issue?.path[0] || 'geral';

            return res.status(400).json({ error: message, field: fieldName });
        }

        const { username, email, password, birthDate } = validation.data;

        const conflict = await prisma.user.findFirst({
            where: {
                OR: [
                    { email },
                    { username }
                ]
            },
            select: {
                email: true,
                username: true
            }
        });

        if (conflict?.email === email) {
            return sendRegistrationConflict(res, 'email');
        }

        if (conflict?.username === username) {
            return sendRegistrationConflict(res, 'username');
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const activationToken = crypto.randomBytes(32).toString('hex');
        const activationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                birthDate: parseBirthDate(birthDate),
                activationToken,
                activationExpiresAt
            }
        });

        try {
            await authNotificationService.sendActivationEmail({
                toEmail: email,
                username,
                token: activationToken
            });
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
        if (conflictField) {
            return sendRegistrationConflict(res, conflictField);
        }

        return next(error);
    }
}

async function activateAccount(req: Request, res: Response, next: NextFunction) {
    const token = String(req.params.token);

    try {
        const activationResult = await prisma.$transaction(async (tx) => {
            const now = new Date();
            const user = await tx.user.findFirst({
                where: {
                    activationToken: token,
                    status: 'Pendente'
                },
                select: {
                    id: true,
                    activationExpiresAt: true
                }
            });

            if (!user) {
                return { error: 'Link de ativação inválido!' };
            }

            if (!user.activationExpiresAt || now > user.activationExpiresAt) {
                return {
                    error: 'Este link de ativação expirou. Solicite um novo e-mail de ativação.'
                };
            }

            const updateResult = await tx.user.updateMany({
                where: {
                    id: user.id,
                    status: 'Pendente',
                    activationToken: token,
                    activationExpiresAt: { gt: now }
                },
                data: {
                    status: 'Ativada',
                    activationToken: null,
                    activationExpiresAt: null
                }
            });

            if (updateResult.count !== 1) {
                return { error: 'Link de ativação inválido!' };
            }

            return { activated: true };
        });

        if ('error' in activationResult) {
            return res.status(400).json({ error: activationResult.error });
        }

        return res.status(200).json({
            message: 'Conta ativada com sucesso!'
        });

    } catch (error) {
        return next(error);
    }
}

async function resendActivation(req: Request, res: Response, next: NextFunction) {
    const { email } = req.body as { email?: string };

    if (!email) {
        return res.status(400).json({ error: 'O e-mail é obrigatório.' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                username: true,
                status: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'Endereço de e-mail não cadastrado' });
        }

        if (user.status === 'Ativada') {
            return res.status(400).json({ error: 'Este endereço de e-mail pertence a uma conta ativada.' });
        }

        if (user.status !== 'Pendente') {
            return res.status(400).json({
                error: 'Somente contas pendentes podem solicitar um novo link de ativação.'
            });
        }

        const newActivationToken = crypto.randomBytes(32).toString('hex');
        const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                activationToken: newActivationToken,
                activationExpiresAt: newExpiresAt
            }
        });

        try {
            await authNotificationService.sendActivationEmail({
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
}

async function loginUser(req: Request, res: Response, next: NextFunction) {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                username: true,
                passwordHash: true,
                status: true,
                nivelAcesso: true
            }
        });

        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas!' });
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
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
            const current = await tx.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, status: true } });
            if (!current || current.passwordHash !== user.passwordHash || current.status !== 'Ativada') return false;
            await tx.session.create({ data: { userId: user.id, sessionTokenHash } });
            return true;
        });
        if (!created) return res.status(401).json({ error: 'Credenciais inválidas!' });

        res.cookie(SESSION_COOKIE_NAME, sessionToken, getCookieOptions(req));

        return res.status(200).json({
            message: 'Login realizado com sucesso!',
            user: {
                id: String(user.id),
                username: user.username,
                role: user.nivelAcesso
            }
        });

    } catch (error) {
        return next(error);
    }
}

async function getUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedUser = getAuthenticatedUser(req);
        const user = await prisma.user.findUnique({
            where: { id: authenticatedUser.userId },
            select: {
                id: true,
                username: true,
                email: true,
                conteudoAdulto: true,
                nivelAcesso: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'Perfil não encontrado.' });
        }

        return res.status(200).json({ user: toUserResponse(user) });

    } catch (error) {
        return next(error);
    }
}

async function getOwnUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedUser = getAuthenticatedUser(req);
        const user = await prisma.user.findUnique({
            where: { id: authenticatedUser.userId },
            select: {
                username: true,
                email: true,
                conteudoAdulto: true,
                birthDate: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'Perfil não encontrado.' });
        }

        return res.status(200).json({
            user: {
                username: user.username,
                email: user.email,
                conteudo_adulto: user.conteudoAdulto && isAdult(user.birthDate),
                can_enable_adult_content: isAdult(user.birthDate)
            }
        });

    } catch (error) {
        return next(error);
    }
}

async function getUserById(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedUser = getAuthenticatedUser(req);
        const targetId = String(req.params.id);
        const requesterId = authenticatedUser.userId;
        const requesterRole = authenticatedUser.role;

        if (requesterRole === 'Usuário Padrão' && targetId !== requesterId) {
            return res.status(403).json({ error: ACCESS_DENIED_MESSAGE });
        }

        const user = await prisma.user.findUnique({
            where: { id: targetId },
            select: {
                username: true,
                email: true,
                conteudoAdulto: true,
                status: true,
                nivelAcesso: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        return res.status(200).json({
            username: user.username,
            email: user.email,
            conteudo_adulto: user.conteudoAdulto,
            status: user.status,
            nivel_acesso: user.nivelAcesso
        });

    } catch (error) {
        return next(error);
    }
}

async function updateAdultContent(req: Request, res: Response, next: NextFunction) {
    try {
        const { conteudo_adulto } = req.body as { conteudo_adulto?: unknown };

        if (typeof conteudo_adulto !== 'boolean') {
            return res.status(400).json({
                error: "Formato inválido. A preferência 'conteudo_adulto' deve ser estritamente verdadeira (true) ou falsa (false)."
            });
        }

        const authenticatedUser = getAuthenticatedUser(req);
        if (conteudo_adulto) {
            const profile = await prisma.user.findUnique({ where: { id: authenticatedUser.userId }, select: { birthDate: true } });
            if (!profile) return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
            if (!isAdult(profile.birthDate)) {
                return res.status(403).json({ error: 'Conteúdo +18 exige data de nascimento informada e 18 anos completos.' });
            }
        }
        const user = await prisma.user.update({
            where: { id: authenticatedUser.userId },
            data: { conteudoAdulto: conteudo_adulto },
            select: { conteudoAdulto: true }
        });

        return res.status(200).json({
            message: 'Preferência de exibição atualizada com sucesso!',
            conteudo_adulto: user.conteudoAdulto
        });

    } catch (error) {
        const knownError = error as PrismaKnownError;
        if (knownError.code === 'P2025') {
            return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
        }

        return next(error);
    }
}

async function updateUserById(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedUser = getAuthenticatedUser(req);
        const targetId = String(req.params.id);
        const requesterId = authenticatedUser.userId;
        const requesterRole = authenticatedUser.role;

        if (requesterRole === 'Usuário Padrão' && targetId !== requesterId) {
            return res.status(403).json({ error: ACCESS_DENIED_MESSAGE });
        }

        return res.status(200).json({ message: 'Permissão concedida. Rota de atualização genérica em construção.' });

    } catch (error) {
        return next(error);
    }
}

async function deleteOwnAccount(req: Request, res: Response, next: NextFunction) {
    try {
        const { currentPassword } = req.body as { currentPassword?: unknown };

        if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
            return res.status(400).json({ error: 'Informe sua senha atual.' });
        }

        const authenticatedUser = getAuthenticatedUser(req);
        const user = await prisma.user.findUnique({
            where: { id: authenticatedUser.userId },
            select: {
                id: true,
                passwordHash: true
            }
        });

        if (!user) {
            clearSessionCookie(req, res);
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Senha atual incorreta!' });
        }

        await prisma.user.delete({
            where: { id: authenticatedUser.userId }
        });

        clearSessionCookie(req, res);

        return res.status(200).json({ message: 'Conta excluida permanentemente.' });

    } catch (error) {
        const knownError = error as PrismaKnownError;
        if (knownError.code === 'P2025') {
            clearSessionCookie(req, res);
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }

        return next(error);
    }
}

async function logoutUser(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedSession = getAuthenticatedSession(req);
        await prisma.session.updateMany({
            where: {
                id: authenticatedSession.id,
                revokedAt: null
            },
            data: {
                revokedAt: new Date()
            }
        });

        clearSessionCookie(req, res);

        return res.status(200).json({ message: 'Sessão encerrada com sucesso.' });

    } catch (error) {
        return next(error);
    }
}

export = {
    registerUser,
    activateAccount,
    resendActivation,
    loginUser,
    logoutUser,
    getUserProfile,
    getOwnUserProfile,
    getUserById,
    updateAdultContent,
    updateUserById,
    deleteOwnAccount
};
