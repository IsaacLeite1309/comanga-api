import { PrismaMediaAssetRepository } from './PrismaMediaAssetRepository';
import type { Prisma } from '@prisma/client';
import prisma from '../../../prisma';
import { getMediaStorage } from '../../../infrastructure/container';
import structuredLogger from '../../../infrastructure/logging/structuredLogger';

async function isCoverAssetAttachable(assetId: string, currentAssetId?: string | null): Promise<boolean> {
    const asset = await prisma.mediaAsset.findUnique({
        where: { id: assetId },
        select: {
            id: true,
            status: true,
            work: { select: { id: true } },
            edition: { select: { id: true } },
            volume: { select: { id: true } }
        }
    });

    if (!asset || !['Pendente', 'Ativo'].includes(asset.status)) return false;
    if (asset.id === currentAssetId) return true;
    return !asset.work && !asset.edition && !asset.volume;
}

function activateCoverAsset(tx: Prisma.TransactionClient, assetId: string) {
    return tx.mediaAsset.update({
        where: { id: assetId },
        data: {
            status: 'Ativo',
            ativadoEm: new Date()
        }
    });
}

async function deleteOrphanedCoverAsset(assetId: string | null | undefined): Promise<void> {
    if (!assetId) return;
    const repository = new PrismaMediaAssetRepository();
    try {
        const asset = await repository.claimRemoval(assetId);
        if (!asset || asset.attached) return;
        await getMediaStorage().deleteObjects([asset.objectKey, ...asset.variants.map(variant => variant.objectKey)]);
        await repository.delete(assetId);
    } catch (error) {
        structuredLogger.error('media.orphan_cleanup_failed', { assetId }, error);
    }
}

// Explicit maintenance command: retries failures and intermediate covers from concurrent replacements.
async function cleanupDiscardedCoverAssets(): Promise<void> {
    try {
        const assets = await prisma.mediaAsset.findMany({ where: { status: 'Descartando' }, select: { id: true }, take: 20 });
        for (const asset of assets) await deleteOrphanedCoverAsset(asset.id);
    } catch {
        structuredLogger.error('media.discard_cleanup_failed');
    }
}

export {
    cleanupDiscardedCoverAssets,
    activateCoverAsset,
    deleteOrphanedCoverAsset,
    isCoverAssetAttachable
};
