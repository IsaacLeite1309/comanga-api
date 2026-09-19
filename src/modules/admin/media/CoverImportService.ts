import crypto from 'node:crypto';
import type MediaStorage from '../../../infrastructure/contracts/MediaStorage';
import type { DownloadedImage } from '../../../infrastructure/media/RemoteImageDownloader';
import type { MediaPublicUrlResolver } from '../../../infrastructure/media/mediaPublicUrl';
import { resolveCoverUrl } from '../../../infrastructure/media/mediaPublicUrl';

interface ProcessedMediaObject {
    kind: string;
    body: Buffer;
    contentType: string;
    width: number;
    height: number;
}

interface ProcessedCover {
    master: ProcessedMediaObject;
    variants: ProcessedMediaObject[];
    checksum: string;
    format: string;
}

interface PersistedAsset {
    id: string;
    objectKey: string;
    variants: Array<{
        kind: string;
        objectKey: string;
    }>;
    [key: string]: unknown;
}

interface MediaAssetRepository {
    create(input: {
        provider: string;
        objectKey: string;
        sourceUrl: string;
        mimeType: string;
        format: string;
        width: number;
        height: number;
        bytes: number;
        checksum: string;
        createdByUserId: string;
        variants: Array<{
            kind: string;
            objectKey: string;
            mimeType: string;
            width: number;
            height: number;
            bytes: number;
        }>;
    }): Promise<PersistedAsset>;
}

interface CoverImportDependencies {
    storage: MediaStorage;
    repository: MediaAssetRepository;
    download: (url: string) => Promise<DownloadedImage>;
    processImage: (bytes: Buffer) => Promise<ProcessedCover>;
    createId?: () => string;
    resolvePublicUrl: MediaPublicUrlResolver;
}

interface ImportCoverInput {
    sourceUrl: string;
    userId: string;
}

function objectSuffix(kind: string) {
    if (kind === 'MASTER') return 'master';
    if (kind === 'COVER_SMALL') return 'small';
    if (kind === 'COVER_LARGE') return 'large';
    return kind.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

class CoverImportService {
    private readonly createId: () => string;

    constructor(private readonly dependencies: CoverImportDependencies) {
        this.createId = dependencies.createId || (() => crypto.randomUUID());
    }

    async importFromUrl({ sourceUrl, userId }: ImportCoverInput) {
        const downloaded = await this.dependencies.download(sourceUrl);
        const processed = await this.dependencies.processImage(downloaded.bytes);
        const id = this.createId();
        const objects = [processed.master, ...processed.variants].map((object) => ({
            ...object,
            key: `covers/${id}/${objectSuffix(object.kind)}.${processed.format}`
        }));
        const uploadedKeys: string[] = [];

        try {
            for (const object of objects) {
                await this.dependencies.storage.putObject({
                    key: object.key,
                    body: object.body,
                    contentType: object.contentType,
                    cacheControl: 'public, max-age=31536000, immutable'
                });
                uploadedKeys.push(object.key);
            }

            const [master, ...variants] = objects;
            const asset = await this.dependencies.repository.create({
                provider: this.dependencies.storage.provider,
                objectKey: master.key,
                sourceUrl: downloaded.finalUrl,
                mimeType: master.contentType,
                format: processed.format,
                width: master.width,
                height: master.height,
                bytes: master.body.length,
                checksum: processed.checksum,
                createdByUserId: userId,
                variants: variants.map((variant) => ({
                    kind: variant.kind,
                    objectKey: variant.key,
                    mimeType: variant.contentType,
                    width: variant.width,
                    height: variant.height,
                    bytes: variant.body.length
                }))
            });

            return {
                ...asset,
                coverUrl: resolveCoverUrl(asset, this.dependencies.resolvePublicUrl)
            };
        } catch (error) {
            if (uploadedKeys.length > 0) {
                await this.dependencies.storage.deleteObjects(uploadedKeys).catch(() => undefined);
            }
            throw error;
        }
    }
}

export { CoverImportService };
export type {
    CoverImportDependencies,
    ImportCoverInput,
    MediaAssetRepository,
    PersistedAsset,
    ProcessedCover,
    ProcessedMediaObject
};
