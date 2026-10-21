import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import ApplicationError from '../../errors/ApplicationError';
import { visibleEdition, visibleVolume } from './queries';

type Transaction = Prisma.TransactionClient;
type Batch = { addVolumeIds: number[]; removeVolumeIds: number[] };

function unavailable(): never {
    throw new ApplicationError({ statusCode: 404, code: 'PERSONAL_ITEM_NOT_FOUND', message: 'Item indisponível para seu acervo.' });
}

// O lock por conta cobre vínculos inexistentes. KEY SHARE impede remoção da conta;
// a leitura compartilhada do catálogo convive com outras contas e bloqueia seus writers.
function personalTransaction<T>(userId: string, operation: (tx: Transaction) => Promise<T>) {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(9142027, hashtext(${userId}))::text`;
        const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${userId}::uuid FOR KEY SHARE`;
        if (!users.length) unavailable();
        await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(9142026)::text`;
        return operation(tx);
    }, { maxWait: 10000, timeout: 15000 });
}

async function requireVolume(tx: Transaction, volumeId: number, adult: boolean) {
    const volume = await tx.volume.findFirst({ where: { id: volumeId, ...visibleVolume(adult) }, select: { id: true } });
    if (!volume) unavailable();
}

async function ownVolume(tx: Transaction, userId: string, volumeId: number) {
    const where = { userId_volumeId: { userId, volumeId } };
    const current = await tx.userVolume.findUnique({ where });
    const read = current?.state === 'Owned' ? current.read as boolean : false;
    await tx.userVolume.upsert({ where, create: { userId, volumeId, state: 'Owned', read }, update: { state: 'Owned', read } });
    return { volumeId, owned: true, read, wished: false };
}

function addOwned(userId: string, volumeId: number, adult: boolean) {
    return personalTransaction(userId, async tx => {
        await requireVolume(tx, volumeId, adult);
        return ownVolume(tx, userId, volumeId);
    });
}

function addWanted(userId: string, volumeId: number, adult: boolean) {
    return personalTransaction(userId, async tx => {
        await requireVolume(tx, volumeId, adult);
        const where = { userId_volumeId: { userId, volumeId } };
        const current = await tx.userVolume.findUnique({ where });
        if (current?.state === 'Owned') {
            throw new ApplicationError({ statusCode: 409, code: 'VOLUME_ALREADY_OWNED', message: 'Este Volume já pertence à sua Estante Digital.' });
        }
        await tx.userVolume.upsert({ where, create: { userId, volumeId, state: 'Wanted', read: null }, update: {} });
        return { volumeId, owned: false, wished: true };
    });
}

function updateRead(userId: string, volumeId: number, read: boolean, adult: boolean) {
    return personalTransaction(userId, async tx => {
        await requireVolume(tx, volumeId, adult);
        const result = await tx.userVolume.updateMany({ where: { userId, volumeId, state: 'Owned' }, data: { read } });
        if (!result.count) unavailable();
        return { volumeId, owned: true, read, wished: false };
    });
}

function removeItem(userId: string, volumeId: number, state: 'Owned' | 'Wanted') {
    return personalTransaction(userId, async tx => {
        await tx.userVolume.deleteMany({ where: { userId, volumeId, state } });
    });
}

function syncOwned(userId: string, editionId: number, batch: Batch, adult: boolean) {
    return personalTransaction(userId, async tx => {
        const edition = await tx.edition.findFirst({ where: { id: editionId, ...visibleEdition(adult) }, select: { id: true } });
        if (!edition) unavailable();
        const ids = [...batch.addVolumeIds, ...batch.removeVolumeIds];
        const validCount = await tx.volume.count({ where: { id: { in: ids }, editionId, ...visibleVolume(adult) } });
        if (validCount !== ids.length) unavailable();
        await tx.userVolume.deleteMany({ where: { userId, volumeId: { in: batch.removeVolumeIds }, state: 'Owned' } });
        if (batch.addVolumeIds.length) {
            await tx.$executeRaw`
                INSERT INTO user_volumes (user_id, volume_id, state, read)
                SELECT ${userId}::uuid, ids.volume_id, 'Owned', false
                FROM unnest(ARRAY[${Prisma.join(batch.addVolumeIds)}]::int[]) AS ids(volume_id)
                ON CONFLICT (user_id, volume_id)
                DO UPDATE SET state = 'Owned',
                    read = CASE WHEN user_volumes.state = 'Owned' THEN user_volumes.read ELSE false END
            `;
        }
        return { editionId, addedVolumeIds: batch.addVolumeIds, removedVolumeIds: batch.removeVolumeIds };
    });
}

export { addOwned, addWanted, updateRead, removeItem, syncOwned };
