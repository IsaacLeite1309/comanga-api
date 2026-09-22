import type { Request } from 'express';
import prisma from '../../prisma';
import authModule from '../auth';

interface OwnProfileView {
    username: string;
    email: string;
    conteudo_adulto: boolean;
    can_enable_adult_content: boolean;
    profiles: string[];
    active_profile: string;
}

function getAuthenticatedUser(req: Request) {
    if (!req.user) throw new Error('Usuario autenticado nao encontrado na requisicao.');
    return req.user;
}

function getAuthenticatedSession(req: Request) {
    if (!req.session) throw new Error('Sessao autenticada nao encontrada na requisicao.');
    return req.session;
}

// Visão única do próprio perfil: consulta, troca de perfil ativo e troca de nome respondem o mesmo contrato.
async function loadOwnProfileView(userId: string, activeProfile: string): Promise<OwnProfileView | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, email: true, conteudoAdulto: true, birthDate: true }
    });
    if (!user) return null;
    const profiles = await authModule.listProfileNamesByUser(prisma, userId);
    return {
        username: user.username,
        email: user.email,
        conteudo_adulto: user.conteudoAdulto && authModule.isAdult(user.birthDate),
        can_enable_adult_content: authModule.isAdult(user.birthDate),
        profiles,
        active_profile: authModule.resolveActiveProfileName(profiles, activeProfile)
    };
}

export { getAuthenticatedSession, getAuthenticatedUser, loadOwnProfileView };
export type { OwnProfileView };
