import type { Request } from 'express';
import { z } from 'zod';

const ROLE_VALUES = ['Administrador', 'Usuário Padrão'] as const;
const STATUS_VALUES = ['Pendente', 'Ativada', 'Bloqueada'] as const;
const SELF_ROLE_CHANGE_MESSAGE = 'Você não pode alterar o nível de acesso de sua própria conta!';

interface PrismaKnownError {
    code?: string;
}

const listUsersQuerySchema = z.object({
    term: z.string().trim().optional(),
    role: z.enum(ROLE_VALUES).optional(),
    status: z.enum(STATUS_VALUES).optional(),
    order: z.enum(['ASC', 'DESC']).default('ASC'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(8)
});

const updateRoleSchema = z.object({
    role: z.enum(ROLE_VALUES)
});

function normalizeUser(user: {
    id: string;
    username: string;
    email: string;
    nivelAcesso: string;
    status: string;
}) {
    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        role: user.nivelAcesso,
        status: user.status
    };
}

function getAuthenticatedAdminId(req: Request): string {
    if (!req.user) {
        throw new Error('Usuário autenticado não encontrado na requisição.');
    }

    return req.user.userId;
}

export {
    SELF_ROLE_CHANGE_MESSAGE,
    getAuthenticatedAdminId,
    listUsersQuerySchema,
    normalizeUser,
    updateRoleSchema
};
export type { PrismaKnownError };
