import ApplicationError from '../../../errors/ApplicationError';
import type MediaStorage from '../../../infrastructure/contracts/MediaStorage';

interface RemovableCoverAsset {
    id: string;
    objectKey: string;
    variants: Array<{ objectKey: string }>;
    attached: boolean;
}

interface CoverRemovalRepository {
    claimRemoval(assetId: string, userId: string): Promise<RemovableCoverAsset | null>;
    delete(assetId: string): Promise<void>;
}

interface CoverRemovalDependencies {
    repository: CoverRemovalRepository;
    storage: Pick<MediaStorage, 'deleteObjects'>;
}

class CoverRemovalService {
    constructor(private readonly dependencies: CoverRemovalDependencies) {}

    async removePending({ assetId, userId }: { assetId: string; userId: string }): Promise<void> {
        // This atomic claim makes the asset unattachable before touching storage.
        const asset = await this.dependencies.repository.claimRemoval(assetId, userId);
        if (!asset) {
            throw new ApplicationError({
                statusCode: 404,
                code: 'MEDIA_ASSET_NOT_FOUND',
                message: 'Capa interna não encontrada.'
            });
        }
        if (asset.attached) {
            throw new ApplicationError({
                statusCode: 409,
                code: 'MEDIA_ASSET_IN_USE',
                message: 'A capa já está associada a um registro.'
            });
        }

        await this.dependencies.storage.deleteObjects([
            asset.objectKey,
            ...asset.variants.map((variant) => variant.objectKey)
        ]);
        await this.dependencies.repository.delete(assetId);
    }
}

export { CoverRemovalService };
export type { CoverRemovalDependencies, CoverRemovalRepository, RemovableCoverAsset };
