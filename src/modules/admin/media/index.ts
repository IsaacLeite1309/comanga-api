import type { NextFunction, Request, Response } from 'express';
import type MediaStorage from '../../../infrastructure/contracts/MediaStorage';
import type { MediaAsset } from '../../../infrastructure/contracts/MediaStorage';
import {
    getMediaStorage,
    isMediaPocEnabled
} from '../../../infrastructure/container';

interface MediaPocMetrics {
    activeAssets: number;
    totalBytes: number;
    imports: number;
    replacements: number;
    deletions: number;
}

interface AdminMediaDependencies {
    isEnabled: () => boolean;
    getStorage: () => MediaStorage;
    registry: InMemoryMediaPocRegistry;
}

class InMemoryMediaPocRegistry {
    private readonly assets = new Map<string, MediaAsset>();
    private imports = 0;
    private replacements = 0;
    private deletions = 0;

    registerImport(asset: MediaAsset): void {
        if (asset.publicId) this.assets.set(asset.publicId, asset);
        this.imports += 1;
    }

    registerReplacement(asset: MediaAsset): void {
        if (asset.publicId) this.assets.set(asset.publicId, asset);
        this.replacements += 1;
    }

    registerDeletion(publicId: string): void {
        this.assets.delete(publicId);
        this.deletions += 1;
    }

    getMetrics(): MediaPocMetrics {
        return {
            activeAssets: this.assets.size,
            totalBytes: [...this.assets.values()]
                .reduce((total, asset) => total + (asset.bytes || 0), 0),
            imports: this.imports,
            replacements: this.replacements,
            deletions: this.deletions
        };
    }
}

function isHttpsUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;

    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

function isPublicId(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 255
        && /^[a-zA-Z0-9/_-]+$/.test(value);
}

function disabledResponse(res: Response): Response {
    return res.status(503).json({
        error: 'A prova de conceito de mídia não está habilitada.',
        code: 'MEDIA_POC_DISABLED'
    });
}

function invalidInputResponse(res: Response): Response {
    return res.status(400).json({
        error: 'Informe uma URL HTTPS válida para a capa.',
        code: 'MEDIA_SOURCE_URL_INVALID'
    });
}

function createAdminMediaHandlers({ isEnabled, getStorage, registry }: AdminMediaDependencies) {
    return {
        async importCover(req: Request, res: Response, next: NextFunction) {
            if (!isEnabled()) return disabledResponse(res);
            if (!isHttpsUrl(req.body?.url)) return invalidInputResponse(res);

            try {
                const asset = await getStorage().importFromUrl({ sourceUrl: req.body.url });
                registry.registerImport(asset);
                return res.status(201).json({ asset });
            } catch (error) {
                return next(error);
            }
        },

        async replaceCover(req: Request, res: Response, next: NextFunction) {
            if (!isEnabled()) return disabledResponse(res);
            if (!isHttpsUrl(req.body?.url) || !isPublicId(req.body?.publicId)) {
                return invalidInputResponse(res);
            }

            try {
                const asset = await getStorage().replaceFromUrl({
                    sourceUrl: req.body.url,
                    publicId: req.body.publicId
                });
                registry.registerReplacement(asset);
                return res.status(200).json({ asset });
            } catch (error) {
                return next(error);
            }
        },

        async deleteCover(req: Request, res: Response, next: NextFunction) {
            if (!isEnabled()) return disabledResponse(res);
            if (!isPublicId(req.body?.publicId)) {
                return res.status(400).json({
                    error: 'Informe um identificador de mídia válido.',
                    code: 'MEDIA_PUBLIC_ID_INVALID'
                });
            }

            try {
                await getStorage().delete(req.body.publicId);
                registry.registerDeletion(req.body.publicId);
                return res.status(204).end();
            } catch (error) {
                return next(error);
            }
        },

        getMetrics(_req: Request, res: Response) {
            if (!isEnabled()) return disabledResponse(res);
            return res.status(200).json({ metrics: registry.getMetrics() });
        }
    };
}

const mediaPocRegistry = new InMemoryMediaPocRegistry();
const handlers = createAdminMediaHandlers({
    isEnabled: isMediaPocEnabled,
    getStorage: getMediaStorage,
    registry: mediaPocRegistry
});

export = {
    ...handlers,
    createAdminMediaHandlers,
    InMemoryMediaPocRegistry,
    mediaPocRegistry
};
