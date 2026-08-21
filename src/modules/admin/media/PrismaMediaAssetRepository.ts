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

    async findRemovable(assetId: string, userId: string) {
        const asset = await prisma.mediaAsset.findFirst({
            where: {
                id: assetId,
                createdByUserId: userId,
                status: 'Pendente'
            },
            select: {
                id: true,
                objectKey: true,
                variants: { select: { objectKey: true } },
                work: { select: { id: true } },
                edition: { select: { id: true } },
                volume: { select: { id: true } }
            }
        });
        if (!asset) return null;
        return {
            id: asset.id,
            objectKey: asset.objectKey,
            variants: asset.variants,
            attached: Boolean(asset.work || asset.edition || asset.volume)
        };
    }

    async delete(assetId: string): Promise<void> {
        await prisma.mediaAsset.delete({ where: { id: assetId } });
    }
}

export { PrismaMediaAssetRepository };
