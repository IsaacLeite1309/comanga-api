import type { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../prisma';

const ROLE_VALUES = ['Administrador', 'Usuário Padrão'] as const;
const STATUS_VALUES = ['Pendente', 'Ativada', 'Bloqueada'] as const;
const SELF_ROLE_CHANGE_MESSAGE = 'Você não pode alterar o nível de acesso de sua própria conta!';

interface PrismaKnownError {
    code?: string;
}

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
        throw new Error('Usuario autenticado nao encontrado na requisicao.');
    }

    return req.user.userId;
}

const listUsersQuerySchema = z.object({
    term: z.string().trim().optional(),
    role: z.enum(ROLE_VALUES).optional(),
    status: z.enum(STATUS_VALUES).optional(),
    order: z.enum(['ASC', 'DESC']).default('ASC'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10)
});

const updateRoleSchema = z.object({
    role: z.enum(ROLE_VALUES)
});

async function listUsers(req: Request, res: Response) {
    const validation = listUsersQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({
            error: 'Filtros de consulta invalidos.'
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
        console.error('Erro ao listar usuarios para administracao:', error);
        return res.status(500).json({ error: 'Erro interno ao listar usuários.' });
    }
}

async function updateUserRole(req: Request, res: Response) {
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

        console.error('Erro ao atualizar nivel de acesso:', error);
        return res.status(500).json({ error: 'Erro interno ao atualizar nível de acesso.' });
    }
}

export = {
    listUsers,
    updateUserRole
};
