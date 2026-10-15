import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import ApplicationError from '../../errors/ApplicationError';
import { visibleEdition, visibleVolume, editionSelect, volumeSelect, volumeOrder } from './queries';
import { mapEdition, mapVolume, mapWork, pagination } from './views';

type Page = { page: number; limit: number };
type Transaction = Prisma.TransactionClient;

function readTransaction<T>(operation: (tx: Transaction) => Promise<T>) {
    return prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
type Progress = { owned: number; total: number; read: number };

async function groupedProgress(tx: Transaction, userId: string, editionIds: number[]) {
    if (!editionIds.length) return new Map<number, Progress>();
    const rows = await tx.$queryRaw<Array<Progress & { editionId: number }>>(Prisma.sql`
        SELECT volume.edition_id AS "editionId", COUNT(*)::int AS total,
               COUNT(personal.volume_id)::int AS owned,
               COUNT(personal.volume_id) FILTER (WHERE personal.read = TRUE)::int AS read
        FROM volumes volume
        LEFT JOIN user_volumes personal ON personal.volume_id = volume.id
            AND personal.user_id = ${userId}::uuid AND personal.state = 'Owned'
        WHERE volume.edition_id IN (${Prisma.join(editionIds)}) AND volume.visibility = 'Público'
        GROUP BY volume.edition_id
    `);
    return new Map(rows.map(row => [row.editionId, { owned: row.owned, total: row.total, read: row.read }]));
}
function collectionEditionSelect(userId: string) {
    return {
        ...editionSelect,
        volumes: {
            where: { visibility: 'Público', userVolumes: { some: { userId, state: 'Owned' } } },
            select: { ...volumeSelect, userVolumes: { where: { userId }, select: { read: true } } },
            orderBy: volumeOrder, take: 50
        }
    } satisfies Prisma.EditionSelect;
}
type CollectionEdition = Prisma.EditionGetPayload<{ select: ReturnType<typeof collectionEditionSelect> }>;
function collectionEdition(edition: CollectionEdition, editionProgress: Progress) {
    return {
        edition: mapEdition(edition), progress: editionProgress,
        volumes: edition.volumes.map(volume => ({ ...mapVolume(volume), read: volume.userVolumes[0].read })),
        volumesPagination: pagination(1, 50, editionProgress.owned)
    };
}
function listCollection(userId: string, adult: boolean, page: Page) {
    return readTransaction(async tx => {
        const where: Prisma.EditionWhereInput = {
            ...visibleEdition(adult),
            volumes: { some: { visibility: 'Público', userVolumes: { some: { userId, state: 'Owned' } } } }
        };
        const [editions, total] = await Promise.all([
            tx.edition.findMany({ where, select: collectionEditionSelect(userId), skip: (page.page - 1) * page.limit, take: page.limit,
                orderBy: [{ work: { title: 'asc' } }, { workId: 'asc' }, { chronologicalNumber: 'asc' }, { id: 'asc' }] }),
            tx.edition.count({ where })
        ]);
        const progresses = await groupedProgress(tx, userId, editions.map(edition => edition.id));
        const groups = new Map<number, { work: ReturnType<typeof mapWork>; editions: ReturnType<typeof collectionEdition>[] }>();
        for (const edition of editions) {
            const group = groups.get(edition.work.id) || { work: mapWork(edition.work), editions: [] };
            group.editions.push(collectionEdition(edition, progresses.get(edition.id) ?? { owned: 0, total: 0, read: 0 }));
            groups.set(edition.work.id, group);
        }
        return { works: [...groups.values()], pagination: pagination(page.page, page.limit, total) };
    });
}
function getEditionSelection(userId: string, editionId: number, adult: boolean, page: Page) {
    return readTransaction(async tx => {
        const edition = await tx.edition.findFirst({ where: { id: editionId, ...visibleEdition(adult) }, select: editionSelect });
        if (!edition) throw new ApplicationError({ statusCode: 404, code: 'PERSONAL_ITEM_NOT_FOUND', message: 'Edição indisponível para seu acervo.' });
        const [volumes, progresses] = await Promise.all([
            tx.volume.findMany({ where: { editionId, visibility: 'Público' },
                select: { ...volumeSelect, userVolumes: { where: { userId }, select: { state: true, read: true } } },
                orderBy: volumeOrder, skip: (page.page - 1) * page.limit, take: page.limit }),
            groupedProgress(tx, userId, [editionId])
        ]);
        const editionProgress = progresses.get(editionId) ?? { owned: 0, total: 0, read: 0 };
        return {
            edition: { ...mapEdition(edition), work: mapWork(edition.work) },
            volumes: volumes.map(volume => ({ ...mapVolume(volume),
                owned: volume.userVolumes[0]?.state === 'Owned', read: volume.userVolumes[0]?.read ?? null,
                wished: volume.userVolumes[0]?.state === 'Wanted' })),
            progress: editionProgress, pagination: pagination(page.page, page.limit, editionProgress.total)
        };
    });
}
function listWishlist(userId: string, adult: boolean, page: Page) {
    return readTransaction(async tx => {
        const where = { userId, state: 'Wanted', volume: visibleVolume(adult) };
        const [items, total] = await Promise.all([
            tx.userVolume.findMany({ where, select: { volume: { select: { ...volumeSelect, edition: { select: editionSelect } } } },
                orderBy: [{ createdAt: 'desc' }, { volumeId: 'asc' }], skip: (page.page - 1) * page.limit, take: page.limit }),
            tx.userVolume.count({ where })
        ]);
        return { volumes: items.map(({ volume }) => ({ ...mapVolume(volume),
            work: mapWork(volume.edition.work), edition: mapEdition(volume.edition) })),
        pagination: pagination(page.page, page.limit, total) };
    });
}
export { listCollection, getEditionSelection, listWishlist };
