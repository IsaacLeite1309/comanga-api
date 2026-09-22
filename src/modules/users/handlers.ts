import bcrypt from 'bcrypt';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import authModule from '../auth';
import { getAuthenticatedUser, loadOwnProfileView } from './ownProfileView';

interface PrismaKnownError { code?: string }

async function getUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedUser = getAuthenticatedUser(req);
        const user = await prisma.user.findUnique({
            where: { id: authenticatedUser.userId },
            select: { id: true, username: true, email: true, conteudoAdulto: true }
        });
        if (!user) return res.status(404).json({ error: 'Perfil não encontrado.' });
        return res.status(200).json({
            user: {
                id: String(user.id),
                username: user.username,
                email: user.email,
                conteudo_adulto: user.conteudoAdulto,
                role: authenticatedUser.activeProfile,
                profiles: authenticatedUser.profiles,
                active_profile: authenticatedUser.activeProfile
            }
        });
    } catch (error) {
        return next(error);
    }
}

async function getOwnUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedUser = getAuthenticatedUser(req);
        const view = await loadOwnProfileView(authenticatedUser.userId, authenticatedUser.activeProfile);
        if (!view) return res.status(404).json({ error: 'Perfil não encontrado.' });
        return res.status(200).json({ user: view });
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
            const profile = await prisma.user.findUnique({
                where: { id: authenticatedUser.userId },
                select: { birthDate: true }
            });
            if (!profile) return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
            if (!authModule.isAdult(profile.birthDate)) {
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
        if ((error as PrismaKnownError).code === 'P2025') {
            return res.status(404).json({ error: 'Usuário não encontrado no banco de dados.' });
        }
        return next(error);
    }
}

// O sistema não pode ficar sem administrador efetivo por exclusão da própria conta.
async function deleteAccountProtectingLastAdmin(userId: string): Promise<{ error?: string }> {
    return prisma.$transaction(async tx => {
        await authModule.lockAdminAssignments(tx);
        await authModule.lockUserRow(tx, userId);
        const profiles = await authModule.listProfileNamesByUser(tx, userId);
        const isEffectiveAdmin = profiles.includes(authModule.ADMIN_PROFILE_NAME);
        if (isEffectiveAdmin && !await authModule.anotherEffectiveAdminRemains(tx, userId)) {
            return { error: authModule.LAST_ADMIN_MESSAGE };
        }
        await tx.user.delete({ where: { id: userId } });
        return {};
    });
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
            select: { id: true, passwordHash: true }
        });
        if (!user) {
            authModule.clearSessionCookie(req, res);
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }
        if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
            return res.status(401).json({ error: 'Senha atual incorreta!' });
        }
        const deletion = await deleteAccountProtectingLastAdmin(authenticatedUser.userId);
        if (deletion.error) return res.status(409).json({ error: deletion.error });
        authModule.clearSessionCookie(req, res);
        return res.status(200).json({ message: 'Conta excluida permanentemente.' });
    } catch (error) {
        if ((error as PrismaKnownError).code === 'P2025') {
            authModule.clearSessionCookie(req, res);
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }
        return next(error);
    }
}

export {
    deleteOwnAccount,
    getOwnUserProfile,
    getUserProfile,
    updateAdultContent
};
