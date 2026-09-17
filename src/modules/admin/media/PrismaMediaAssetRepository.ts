import prisma from '../../../prisma';
import type { MediaAssetRepository } from './CoverImportService';
import type { CoverRemovalRepository } from './CoverRemovalService';

class PrismaMediaAssetRepository implements MediaAssetRepository, CoverRemovalRepository {
    async create(input: Parameters<MediaAssetRepository['create']>[0]) {
        return prisma.mediaAsset.create({
            data: {
                provider: input.provider,
                objectKey: input.objectKey,
                sourceUrl: input.sourceUrl,
                mimeType: input.mimeType,
                format: input.format,
                width: input.width,
                height: input.height,
                bytes: input.bytes,
                checksum: input.checksum,
                createdByUserId: input.createdByUserId,
                variants: {
                    createMany: { data: input.variants }
                }
            },
            select: {
                id: true,
                provider: true,
                objectKey: true,
                mimeType: true,
                format: true,
                width: true,
                height: true,
                bytes: true,
                status: true,
                variants: {
                    select: {
                        kind: true,
                        objectKey: true,
                        mimeType: true,
                        width: true,
                        height: true,
                        bytes: true
                    },
                    orderBy: { kind: 'asc' }
                }
            }
        });
    }

    async claimRemoval(assetId: string, userId?: string) {
        return prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(9142026)::text`;
            const asset = await tx.mediaAsset.findFirst({
                where: { id: assetId, ...(userId ? { createdByUserId: userId, status: { in: ['Pendente', 'Descartando'] } } : {}) },
                select: { id: true, objectKey: true, variants: { select: { objectKey: true } }, work: { select: { id: true } }, edition: { select: { id: true } }, volume: { select: { id: true } } }
            });
            if (!asset) return null;
            const attached = Boolean(asset.work || asset.edition || asset.volume);
            if (!attached) await tx.mediaAsset.update({ where: { id: asset.id }, data: { status: 'Descartando' } });
            return { id: asset.id, objectKey: asset.objectKey, variants: asset.variants, attached };
        });
    }

    async delete(assetId: string): Promise<void> {
        await prisma.mediaAsset.deleteMany({ where: { id: assetId, status: 'Descartando' } });
    }
}

export { PrismaMediaAssetRepository };
