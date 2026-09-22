import type { NextFunction, Request, Response } from 'express';
import prisma from '../../../prisma';
import auth from '../../auth';
import {
    SELF_ROLE_CHANGE_MESSAGE,
    PrismaKnownError,
    buildProfileFilter,
    normalizeUser,
    getAuthenticatedAdminId,
    listUsersQuerySchema,
    updateRoleSchema
} from './domain';

const USER_SELECTION = {
    id: true,
    username: true,
    email: true,
    status: true,
    userProfiles: { select: { profile: { select: { code: true, name: true } } } }
} as const;

async function listUsers(req: Request, res: Response, next: NextFunction) {
    const validation = listUsersQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({
            error: 'Filtros de consulta inválidos.'
        });
    }

    const { term, role, status, order, page, limit } = validation.data;
    const where = {
        ...(term
            ? {
                OR: [
                    { username: { contains: term, mode: 'insensitive' as const } },
                    { email: { contains: term, mode: 'insensitive' as const } }
                ]
            }
            : {}),
        ...buildProfileFilter(role),
        ...(status ? { status } : {})
    };

    try {
        const [users, total] = await prisma.$transaction([
            prisma.user.findMany({
                where,
                select: USER_SELECTION,
                orderBy: {
                    username: order.toLowerCase() as 'asc' | 'desc'
                },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.user.count({ where })
        ]);

        return res.status(200).json({
            users: users.map(normalizeUser),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        return next(error);
    }
}

interface RoleChangeOutcome {
    status?: number;
    error?: string;
    user?: ReturnType<typeof normalizeUser>;
}

// Conceder ou remover a atribuição Administrador de OUTRA conta; o perfil padrão nunca sai.
async function applyRoleChange(targetUserId: string, role: string): Promise<RoleChangeOutcome> {
    return prisma.$transaction(async tx => {
        await auth.lockAdminAssignments(tx);
        await auth.lockUserRow(tx, targetUserId);
        const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
        if (!target) return { status: 404, error: 'Usuário não encontrado.' };

        if (role === auth.ADMIN_PROFILE_NAME) {
            await auth.grantAdminProfile(tx, targetUserId);
        } else {
            const stillHasAdmin = await auth.listProfileNamesByUser(tx, targetUserId);
            if (stillHasAdmin.includes(auth.ADMIN_PROFILE_NAME)
                && !await auth.anotherEffectiveAdminRemains(tx, targetUserId)) {
                return { status: 409, error: auth.LAST_ADMIN_MESSAGE };
            }
            await auth.revokeAdminProfile(tx, targetUserId);
        }

        const updated = await tx.user.findUnique({ where: { id: targetUserId }, select: USER_SELECTION });
        return updated ? { user: normalizeUser(updated) } : { status: 404, error: 'Usuário não encontrado.' };
    });
}

async function updateUserRole(req: Request, res: Response, next: NextFunction) {
    const validation = updateRoleSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Nível de acesso inválido.' });
    }

    const targetUserId = String(req.params.id);
    const authenticatedAdminId = getAuthenticatedAdminId(req);

    if (targetUserId === authenticatedAdminId) {
        return res.status(403).json({ error: SELF_ROLE_CHANGE_MESSAGE });
    }

    try {
        const outcome = await applyRoleChange(targetUserId, validation.data.role);
        if (outcome.error) return res.status(Number(outcome.status)).json({ error: outcome.error });
        return res.status(200).json({ user: outcome.user });

    } catch (error) {
        const knownError = error as PrismaKnownError;
        if (knownError.code === 'P2025') {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        return next(error);
    }
}
export {
    listUsers,
    updateUserRole
};
