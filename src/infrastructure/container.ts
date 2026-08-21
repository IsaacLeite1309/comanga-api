import { NodemailerMailService } from './mail/NodemailerMailService';
import { R2MediaStorage, r2ConfigFromEnvironment } from './media/R2MediaStorage';
import { downloadRemoteImage } from './media/RemoteImageDownloader';
import { processCoverImage } from './media/CoverImageProcessor';
import { mediaPublicUrlResolverFromEnvironment } from './media/mediaPublicUrl';
import { createAuthNotificationService } from '../modules/auth/AuthNotificationService';
import { CoverImportService } from '../modules/admin/media/CoverImportService';
import { PrismaMediaAssetRepository } from '../modules/admin/media/PrismaMediaAssetRepository';
import { CoverRemovalService } from '../modules/admin/media/CoverRemovalService';

const authNotificationService = createAuthNotificationService({
    mailService: new NodemailerMailService()
});

let mediaStorage: R2MediaStorage | undefined;
let coverImportService: CoverImportService | undefined;
let coverRemovalService: CoverRemovalService | undefined;

function getMediaStorage(): R2MediaStorage {
    mediaStorage ||= new R2MediaStorage(r2ConfigFromEnvironment());
    return mediaStorage;
}

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

export {
    authNotificationService,
    getCoverImportService,
    getCoverRemovalService,
    getMediaStorage
};
