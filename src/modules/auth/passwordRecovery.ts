import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import structuredLogger from '../../infrastructure/logging/structuredLogger';
import prisma from '../../prisma';
import { passwordSchema } from './accountRules';

interface PasswordRecoveryNotifications {
    sendPasswordResetEmail(input: { toEmail: string; username: string; token: string }): Promise<void>;
}

const RECOVERY_MESSAGE = 'Se houver uma conta apta para este e-mail, enviaremos as instruções de recuperação.';
const RECOVERY_COOLDOWN_MS = 60_000;
const INVALID_TOKEN = 'Link de redefinição inválido!';
const requestSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    password: passwordSchema,
    confirmPassword: z.string()
}).refine(value => value.password === value.confirmPassword, {
    message: 'Divergência nos valores da senha e confirmação de senha!',
    path: ['confirmPassword']
});
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function createRequestPasswordResetHandler(notifications: PasswordRecoveryNotifications) {
    return async function requestPasswordReset(req: Request, res: Response) {
        const input = requestSchema.safeParse(req.body);
        if (!input.success) return res.status(400).json({ error: 'Informe um e-mail válido.' });

        // Responde antes de consultar a conta ou o provedor para não revelar elegibilidade por latência.
        res.status(200).json({ message: RECOVERY_MESSAGE });
        try {
            const token = crypto.randomBytes(32).toString('hex');
            const user = await prisma.$transaction(async tx => {
                const account = await tx.user.findUnique({
                    where: { email: input.data.email },
                    select: { id: true }
                });
                if (!account) return null;

                // Serializa emissão e consumo por conta, inclusive em solicitações concorrentes.
                await tx.$queryRaw`SELECT id FROM users WHERE id = ${account.id}::uuid FOR UPDATE`;
                const current = await tx.user.findUnique({
                    where: { id: account.id },
                    select: { id: true, username: true, email: true, status: true }
                });
                if (current?.status !== 'Ativada') return null;

                const now = new Date();
                // Considera qualquer emissão recente, inclusive tokens já consumidos, sob o lock da conta.
                const recent = await tx.passwordResetToken.findFirst({
                    where: {
                        userId: current.id,
                        createdAt: { gt: new Date(now.getTime() - RECOVERY_COOLDOWN_MS) }
                    },
                    select: { id: true }
                });
                if (recent) return null;

                await tx.passwordResetToken.updateMany({
                    where: { userId: current.id, usedAt: null },
                    data: { usedAt: now }
                });
                await tx.passwordResetToken.create({
                    data: {
                        userId: current.id,
                        tokenHash: hashToken(token),
                        createdAt: now,
                        expiresAt: new Date(now.getTime() + 60 * 60 * 1000)
                    }
                });
                return current;
            });

            if (user) {
                await notifications.sendPasswordResetEmail({
                    toEmail: user.email,
                    username: user.username,
                    token
                });
            }
        } catch {
            // Erros de banco ou provedor podem conter dados privados e não seguem para o logger global.
            structuredLogger.error('auth.password_recovery_failed');
        }
    };
}

async function resetPassword(req: Request, res: Response, next: NextFunction) {
    const input = resetSchema.safeParse(req.body);
    if (!input.success) {
        const issue = input.error.issues[0];
        return res.status(400).json({
            error: issue?.path[0] === 'token' ? INVALID_TOKEN : issue?.message
        });
    }

    try {
        const tokenHash = hashToken(input.data.token);
        const passwordHash = await bcrypt.hash(input.data.password, 10);
        const error = await prisma.$transaction(async tx => {
            const candidate = await tx.passwordResetToken.findUnique({
                where: { tokenHash },
                select: { userId: true }
            });
            if (!candidate) return INVALID_TOKEN;

            // O mesmo lock usado na emissão impede consumo concorrente para a conta.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.userId}::uuid FOR UPDATE`;
            const token = await tx.passwordResetToken.findUnique({
                where: { tokenHash },
                include: { user: { select: { status: true } } }
            });
            if (!token || token.usedAt || token.user.status !== 'Ativada') return INVALID_TOKEN;

            const now = new Date();
            if (token.expiresAt <= now) {
                return 'Este link de redefinição expirou. Solicite a redefinição novamente.';
            }
            const consumed = await tx.passwordResetToken.updateMany({
                where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
                data: { usedAt: now }
            });
            if (consumed.count !== 1) return INVALID_TOKEN;

            await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
            await tx.session.updateMany({
                where: { userId: token.userId, revokedAt: null },
                data: { revokedAt: now }
            });
            return null;
        });

        if (error) return res.status(400).json({ error });
        return res.status(200).json({ message: 'Senha redefinida com sucesso. Faça login novamente.' });
    } catch {
        // Não encaminha erro de consulta com token_hash/password_hash ao logger genérico.
        structuredLogger.error('auth.password_reset_failed');
        return next(new Error('Não foi possível redefinir a senha.'));
    }
}

function createPasswordRecoveryHandlers(notifications: PasswordRecoveryNotifications) {
    return {
        requestPasswordReset: createRequestPasswordResetHandler(notifications),
        resetPassword
    };
}

export { createPasswordRecoveryHandlers, RECOVERY_MESSAGE };
export type { PasswordRecoveryNotifications };
