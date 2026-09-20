import type { Request } from 'express';
import { z } from 'zod';
import auth from '../../auth';

const ROLE_VALUES = ['Administrador', 'Usuário Padrão'] as const;
const STATUS_VALUES = ['Pendente', 'Ativada', 'Bloqueada'] as const;
const SELF_ROLE_CHANGE_MESSAGE = 'Você não pode alterar o nível de acesso de sua própria conta!';

interface PrismaKnownError {
    code?: string;
}

interface AssignedProfileRow {
    profile: { code: string; name: string };
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

// O filtro administrativo continua sendo pelo nível efetivo: possui ou não a atribuição Administrador.
function buildProfileFilter(role?: (typeof ROLE_VALUES)[number]) {
    if (!role) return {};
    const adminAssignment = { profile: { code: auth.ADMIN_PROFILE_CODE } };
    return role === auth.ADMIN_PROFILE_NAME
        ? { userProfiles: { some: adminAssignment } }
        : { userProfiles: { none: adminAssignment } };
}

function normalizeUser(user: {
    id: string;
    username: string;
    email: string;
    status: string;
    userProfiles: AssignedProfileRow[];
}) {
    const profiles = auth.sortProfileNames(user.userProfiles.map(assignment => assignment.profile.name));
    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        // Campo derivado mantido para compatibilidade dos clientes atuais.
        role: profiles.includes(auth.ADMIN_PROFILE_NAME) ? auth.ADMIN_PROFILE_NAME : auth.DEFAULT_PROFILE_NAME,
        profiles,
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
    buildProfileFilter,
    getAuthenticatedAdminId,
    listUsersQuerySchema,
    normalizeUser,
    updateRoleSchema
};
export type { PrismaKnownError };
