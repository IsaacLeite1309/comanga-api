import type { Prisma } from '@prisma/client';

const LINKED_EDITION_PRIVATE_MESSAGE = 'Essa Edição tem Volumes vinculados a usuários, não pode ser tornada privada!';

async function hasLinkedVolumes(tx: Prisma.TransactionClient, scope: { editionId: number } | { workId: number }) {
    const edition = 'editionId' in scope ? { id: scope.editionId } : { workId: scope.workId, visibility: 'Público' };
    const volume = await tx.volume.findFirst({
        where: { edition, userVolumes: { some: {} } },
        select: { id: true }
    });
    return Boolean(volume);
}

export { hasLinkedVolumes, LINKED_EDITION_PRIVATE_MESSAGE };
