import bcrypt from 'bcrypt';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../prisma';
import authModule from '../auth';
import { getAuthenticatedSession, getAuthenticatedUser, loadOwnProfileView } from './ownProfileView';

interface PrismaKnownError { code?: string }
interface RejectedOperation { status: number; error: string; field?: string }

const PROFILE_NOT_FOUND_MESSAGE = 'Perfil de acesso inexistente.';
const PROFILE_NOT_ASSIGNED_MESSAGE = 'Acesso negado: sua conta não possui este perfil de acesso.';
const USERNAME_CONFLICT_MESSAGE = 'Este nome de usuário não está disponível. Por favor, escolha outro.';
const USER_NOT_FOUND_MESSAGE = 'Perfil não encontrado.';
const SAME_PASSWORD_MESSAGE = 'A nova senha deve ser diferente da senha atual.';

const activeProfileSchema = z.object({ profile: z.string() });
const usernameBodySchema = z.object({ username: authModule.usernameSchema });
const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1, 'Informe sua senha atual.'),
    newPassword: authModule.passwordSchema,
    confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
    message: 'Divergência nos valores da senha e confirmação de senha!',
    path: ['confirmPassword']
});

function isRejected(result: unknown): result is RejectedOperation {
    return Boolean(result) && typeof (result as RejectedOperation).status === 'number';
}

function sendRejection(res: Response, rejection: RejectedOperation) {
    return res.status(rejection.status).json(rejection.field
        ? { error: rejection.error, field: rejection.field }
        : { error: rejection.error });
}

function sendValidationError(res: Response, error: z.ZodError, fallbackField: string) {
    const issue = error.issues[0];
    return res.status(400).json({
        error: issue?.message || 'Dados inválidos.',
        field: issue?.path[0] || fallbackField
    });
}

// Troca o perfil ativo da sessão atual; nunca concede nem remove atribuições.
async function updateActiveProfile(req: Request, res: Response, next: NextFunction) {
    const validation = activeProfileSchema.safeParse(req.body);
    if (!validation.success) return sendValidationError(res, validation.error, 'profile');

    try {
        const { userId } = getAuthenticatedUser(req);
        const session = getAuthenticatedSession(req);
        const result = await prisma.$transaction(async tx => {
            const target = await authModule.findProfileByName(tx, validation.data.profile);
            if (!target) return { status: 400, error: PROFILE_NOT_FOUND_MESSAGE, field: 'profile' };
            const assignment = await tx.userProfile.findUnique({
                where: { userId_profileId: { userId, profileId: target.id } },
                select: { profileId: true }
            });
            if (!assignment) return { status: 403, error: PROFILE_NOT_ASSIGNED_MESSAGE };
            await tx.session.updateMany({
                where: { id: session.id, revokedAt: null },
                data: { activeProfileId: target.id }
            });
            await tx.user.update({ where: { id: userId }, data: { preferredProfileId: target.id } });
            return { activeProfile: target.name };
        });
        if (isRejected(result)) return sendRejection(res, result);

        const view = await loadOwnProfileView(userId, result.activeProfile);
        if (!view) return res.status(404).json({ error: USER_NOT_FOUND_MESSAGE });
        return res.status(200).json({ message: 'Perfil ativo atualizado com sucesso!', user: view });
    } catch (error) {
        return next(error);
    }
}

// Identidade vem apenas da sessão: a rota não aceita outro userId.
async function updateOwnUsername(req: Request, res: Response, next: NextFunction) {
    const validation = usernameBodySchema.safeParse(req.body);
    if (!validation.success) return sendValidationError(res, validation.error, 'username');

    try {
        const { userId, activeProfile } = getAuthenticatedUser(req);
        await prisma.user.update({
            where: { id: userId },
            data: { username: validation.data.username },
            select: { id: true }
        });
        const view = await loadOwnProfileView(userId, activeProfile);
        if (!view) return res.status(404).json({ error: USER_NOT_FOUND_MESSAGE });
        return res.status(200).json({ message: 'Nome de usuário atualizado com sucesso!', user: view });
    } catch (error) {
        const code = (error as PrismaKnownError).code;
        if (code === 'P2002') {
            return res.status(409).json({ error: USERNAME_CONFLICT_MESSAGE, field: 'username' });
        }
        if (code === 'P2025') return res.status(404).json({ error: USER_NOT_FOUND_MESSAGE });
        return next(error);
    }
}

async function applyPasswordChange(
    userId: string,
    currentSessionId: number,
    currentPassword: string,
    newPassword: string
): Promise<RejectedOperation | { changed: true }> {
    return prisma.$transaction(async tx => {
        await authModule.lockUserRow(tx, userId);
        const current = await tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
        if (!current) return { status: 404, error: USER_NOT_FOUND_MESSAGE };
        if (!await bcrypt.compare(currentPassword, current.passwordHash)) {
            return { status: 401, error: 'Senha atual incorreta!', field: 'currentPassword' };
        }
        if (await bcrypt.compare(newPassword, current.passwordHash)) {
            return { status: 400, error: SAME_PASSWORD_MESSAGE, field: 'newPassword' };
        }
        await tx.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
        // A sessão usada na alteração permanece autenticada; as demais são revogadas.
        await tx.session.updateMany({
            where: { userId, revokedAt: null, id: { not: currentSessionId } },
            data: { revokedAt: new Date() }
        });
        return { changed: true };
    });
}

async function updateOwnPassword(req: Request, res: Response, next: NextFunction) {
    const validation = passwordChangeSchema.safeParse(req.body);
    if (!validation.success) return sendValidationError(res, validation.error, 'newPassword');

    try {
        const { userId } = getAuthenticatedUser(req);
        const session = getAuthenticatedSession(req);
        const result = await applyPasswordChange(
            userId,
            session.id,
            validation.data.currentPassword,
            validation.data.newPassword
        );
        if (isRejected(result)) return sendRejection(res, result);
        return res.status(200).json({
            message: 'Senha alterada com sucesso! As demais sessões da conta foram encerradas.'
        });
    } catch (error) {
        return next(error);
    }
}

export {
    PROFILE_NOT_ASSIGNED_MESSAGE,
    PROFILE_NOT_FOUND_MESSAGE,
    SAME_PASSWORD_MESSAGE,
    USERNAME_CONFLICT_MESSAGE,
    updateActiveProfile,
    updateOwnPassword,
    updateOwnUsername
};
