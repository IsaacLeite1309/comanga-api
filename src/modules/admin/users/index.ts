import type { NextFunction, Request, Response } from 'express';
import prisma from '../../../prisma';
import {
    SELF_ROLE_CHANGE_MESSAGE,
    PrismaKnownError,
    normalizeUser,
    getAuthenticatedAdminId,
    listUsersQuerySchema,
    updateRoleSchema
} from '../shared';

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
        ...(role ? { nivelAcesso: role } : {}),
        ...(status ? { status } : {})
    };

    try {
        const [users, total] = await prisma.$transaction([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    username: true,
                    email: true,
                    nivelAcesso: true,
                    status: true
                },
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
        const user = await prisma.user.update({
            where: { id: targetUserId },
            data: { nivelAcesso: validation.data.role },
            select: {
                id: true,
                username: true,
                email: true,
                nivelAcesso: true,
                status: true
            }
        });

        return res.status(200).json({ user: normalizeUser(user) });

    } catch (error) {
        const knownError = error as PrismaKnownError;
        if (knownError.code === 'P2025') {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        return next(error);
    }
}


export = {
    listUsers,
    updateUserRole
};

