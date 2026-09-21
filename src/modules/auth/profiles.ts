import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';

const ADMIN_PROFILE_CODE = 'ADMINISTRADOR';
const DEFAULT_PROFILE_CODE = 'USUARIO_PADRAO';
const ADMIN_PROFILE_NAME = 'Administrador';
const DEFAULT_PROFILE_NAME = 'Usuário Padrão';
const SYSTEM_PROFILE_NAMES = [ADMIN_PROFILE_NAME, DEFAULT_PROFILE_NAME];
const LAST_ADMIN_MESSAGE = 'Operação bloqueada: o sistema ficaria sem nenhum administrador ativo.';

type ProfileClient = Prisma.TransactionClient | typeof prisma;

interface ProfileIdentity {
    id: number;
    code: string;
    name: string;
}

// Perfis são valores controlados pelo sistema; a identidade estável é o code.
async function findProfileByCode(client: ProfileClient, code: string): Promise<ProfileIdentity | null> {
    return client.profile.findUnique({ where: { code }, select: { id: true, code: true, name: true } });
}

async function requireProfileByCode(client: ProfileClient, code: string): Promise<ProfileIdentity> {
    const profile = await findProfileByCode(client, code);
    if (!profile) throw new Error(`Perfil de sistema ausente no banco: ${code}.`);
    return profile;
}

async function findProfileByName(client: ProfileClient, name: string): Promise<ProfileIdentity | null> {
    return client.profile.findUnique({ where: { name }, select: { id: true, code: true, name: true } });
}

function sortProfileNames(names: string[]): string[] {
    return [...new Set(names)].sort((first, second) => first.localeCompare(second, 'pt-BR'));
}

async function listProfileNamesByUser(client: ProfileClient, userId: string): Promise<string[]> {
    const assignments = await client.userProfile.findMany({
        where: { userId },
        select: { profile: { select: { name: true } } }
    });
    return sortProfileNames(assignments.map(assignment => assignment.profile.name));
}

// Perfil ativo só vale enquanto a conta mantiver a atribuição correspondente.
function resolveActiveProfileName(assignedNames: string[], sessionProfileName?: string | null): string {
    if (sessionProfileName && assignedNames.includes(sessionProfileName)) return sessionProfileName;
    return DEFAULT_PROFILE_NAME;
}

async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

// Serializa concessões, remoções e exclusões antes de bloquear qualquer usuário.
async function lockAdminAssignments(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260920, 1)::text`;
}

// Executada sob lockAdminAssignments; cada consulta usa o estado já confirmado.
async function lockEffectiveAdminIds(tx: Prisma.TransactionClient): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT u.id FROM users u
        JOIN user_profiles up ON up.user_id = u.id
        JOIN profiles p ON p.id = up.profile_id
        WHERE p.code = ${ADMIN_PROFILE_CODE} AND u.status = 'Ativada'`;
    return rows.map(row => String(row.id));
}

async function anotherEffectiveAdminRemains(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    const adminIds = await lockEffectiveAdminIds(tx);
    return adminIds.some(id => id !== String(userId));
}

async function grantAdminProfile(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const admin = await requireProfileByCode(tx, ADMIN_PROFILE_CODE);
    await tx.userProfile.upsert({
        where: { userId_profileId: { userId, profileId: admin.id } },
        create: { userId, profileId: admin.id },
        update: {}
    });
    // Escrita dupla transitória: nivel_acesso segue válido para código ainda não migrado.
    // A preferência acompanha a concessão; sessões já abertas mantêm o perfil ativo delas.
    await tx.user.update({
        where: { id: userId },
        data: { nivelAcesso: ADMIN_PROFILE_NAME, preferredProfileId: admin.id }
    });
}

async function revokeAdminProfile(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const admin = await requireProfileByCode(tx, ADMIN_PROFILE_CODE);
    const standard = await requireProfileByCode(tx, DEFAULT_PROFILE_CODE);
    await tx.userProfile.upsert({
        where: { userId_profileId: { userId, profileId: standard.id } },
        create: { userId, profileId: standard.id },
        update: {}
    });
    await tx.userProfile.deleteMany({ where: { userId, profileId: admin.id } });
    await tx.session.updateMany({
        where: { userId, activeProfileId: admin.id },
        data: { activeProfileId: standard.id }
    });
    await tx.user.update({
        where: { id: userId },
        data: { nivelAcesso: DEFAULT_PROFILE_NAME, preferredProfileId: standard.id }
    });
}

// O login herda o perfil preferido apenas quando a conta ainda o possui.
async function resolveLoginProfileId(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const standard = await requireProfileByCode(tx, DEFAULT_PROFILE_CODE);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { preferredProfileId: true } });
    const preferredId = user?.preferredProfileId;
    if (!preferredId) return standard.id;
    const assignment = await tx.userProfile.findUnique({
        where: { userId_profileId: { userId, profileId: preferredId } },
        select: { profileId: true }
    });
    return assignment ? assignment.profileId : standard.id;
}

export {
    ADMIN_PROFILE_CODE,
    ADMIN_PROFILE_NAME,
    DEFAULT_PROFILE_CODE,
    DEFAULT_PROFILE_NAME,
    LAST_ADMIN_MESSAGE,
    SYSTEM_PROFILE_NAMES,
    anotherEffectiveAdminRemains,
    findProfileByCode,
    findProfileByName,
    grantAdminProfile,
    listProfileNamesByUser,
    lockAdminAssignments,
    lockUserRow,
    requireProfileByCode,
    resolveActiveProfileName,
    resolveLoginProfileId,
    revokeAdminProfile,
    sortProfileNames
};
export type { ProfileClient, ProfileIdentity };
