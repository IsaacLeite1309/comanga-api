import bcrypt from 'bcrypt';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import authModule from '../auth';

const ACCESS_DENIED_MESSAGE = 'Acesso negado: Você não tem permissão para acessar ou modificar os dados deste perfil.';

interface PrismaKnownError { code?: string }
interface UserResponseInput {
    id: string;
    username: string;
    email: string;
    conteudoAdulto: boolean;
    nivelAcesso: string;
}

function getAuthenticatedUser(req: Request) {
    if (!req.user) throw new Error('Usuario autenticado nao encontrado na requisicao.');
    return req.user;
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

async function getUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: getAuthenticatedUser(req).userId },
            select: { id: true, username: true, email: true, conteudoAdulto: true, nivelAcesso: true }
        });
        if (!user) return res.status(404).json({ error: 'Perfil não encontrado.' });
        return res.status(200).json({ user: toUserResponse(user) });
    } catch (error) {
        return next(error);
    }
}

async function getOwnUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: getAuthenticatedUser(req).userId },
            select: { username: true, email: true, conteudoAdulto: true, birthDate: true }
        });
        if (!user) return res.status(404).json({ error: 'Perfil não encontrado.' });
        return res.status(200).json({
            user: {
                username: user.username,
                email: user.email,
                conteudo_adulto: user.conteudoAdulto && authModule.isAdult(user.birthDate),
                can_enable_adult_content: authModule.isAdult(user.birthDate)
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
        if (authenticatedUser.role === 'Usuário Padrão' && targetId !== authenticatedUser.userId) {
            return res.status(403).json({ error: ACCESS_DENIED_MESSAGE });
        }
        const user = await prisma.user.findUnique({
            where: { id: targetId },
            select: { username: true, email: true, conteudoAdulto: true, status: true, nivelAcesso: true }
        });
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
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

async function updateUserById(req: Request, res: Response, next: NextFunction) {
    try {
        const authenticatedUser = getAuthenticatedUser(req);
        const targetId = String(req.params.id);
        if (authenticatedUser.role === 'Usuário Padrão' && targetId !== authenticatedUser.userId) {
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
            select: { id: true, passwordHash: true }
        });
        if (!user) {
            authModule.clearSessionCookie(req, res);
            return res.status(404).json({ error: 'Usuario nao encontrado.' });
        }
        if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
            return res.status(401).json({ error: 'Senha atual incorreta!' });
        }
        await prisma.user.delete({ where: { id: authenticatedUser.userId } });
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
    getUserById,
    getUserProfile,
    updateAdultContent,
    updateUserById
};
