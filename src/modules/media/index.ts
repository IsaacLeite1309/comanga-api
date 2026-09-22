import {
    downloadRemoteImage,
    getMediaStorage,
    mediaPublicUrlResolverFromEnvironment,
    processCoverImage
} from '../../infrastructure/container';
import { CoverImportService } from './CoverImportService';
import { CoverRemovalService } from './CoverRemovalService';
import { PrismaMediaAssetRepository } from './PrismaMediaAssetRepository';
import { createAdminMediaHandlers } from './handlers';
export {
    activateCoverAsset,
    cleanupDiscardedCoverAssets,
    deleteOrphanedCoverAsset,
    isCoverAssetAttachable
} from './coverAssetLifecycle';

let coverImportService: CoverImportService | undefined;
let coverRemovalService: CoverRemovalService | undefined;

function getCoverImportService(): CoverImportService {
    coverImportService ||= new CoverImportService({
        storage: getMediaStorage(),
        repository: new PrismaMediaAssetRepository(),
        download: (url) => downloadRemoteImage(url, {
            maxBytes: Number(process.env.MEDIA_MAX_SOURCE_BYTES || 10 * 1024 * 1024),
            timeoutMs: Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || 10_000)
        }),
        processImage: (bytes) => processCoverImage(bytes, {
            maxPixels: Number(process.env.MEDIA_MAX_SOURCE_PIXELS || 40_000_000)
        }),
        resolvePublicUrl: mediaPublicUrlResolverFromEnvironment()
    });
    return coverImportService;
}

function getCoverRemovalService(): CoverRemovalService {
    coverRemovalService ||= new CoverRemovalService({
        storage: getMediaStorage(),
        repository: new PrismaMediaAssetRepository()
    });
    return coverRemovalService;
}

const { importCover, deletePendingCover } = createAdminMediaHandlers({
    getImportService: getCoverImportService,
    getRemovalService: getCoverRemovalService
});

export {
    deletePendingCover,
    importCover
};
