import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { getCoverImportService, getCoverRemovalService } from '../../../infrastructure/container';
import structuredLogger, { StructuredLogger } from '../../../infrastructure/logging/structuredLogger';
import type { CoverImportService } from './CoverImportService';
import type { CoverRemovalService } from './CoverRemovalService';

interface AdminMediaDependencies {
    getImportService: () => Pick<CoverImportService, 'importFromUrl'>;
    getRemovalService: () => Pick<CoverRemovalService, 'removePending'>;
    logger?: Pick<StructuredLogger, 'info' | 'error'>;
    now?: () => number;
}

const importCoverSchema = z.object({
    sourceUrl: z.string().trim().max(2048).refine((value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
            return false;
        }
    })
}).strict();

function createAdminMediaHandlers({
    getImportService,
    getRemovalService,
    logger = structuredLogger,
    now = Date.now
}: AdminMediaDependencies) {
    return {
        async importCover(req: Request, res: Response, next: NextFunction) {
            const validation = importCoverSchema.safeParse(req.body);
            if (!validation.success || !req.user?.userId) {
                return res.status(400).json({
                    error: 'Informe uma URL HTTPS válida para a capa.',
                    code: 'MEDIA_SOURCE_URL_INVALID'
                });
            }

            const startedAt = now();
            try {
                const asset = await getImportService().importFromUrl({
                    sourceUrl: validation.data.sourceUrl,
                    userId: req.user.userId
                });
                logger.info('media.cover_import.completed', {
                    requestId: req.requestId || 'not-provided',
                    userId: req.user.userId,
                    assetId: asset.id,
                    result: 'success',
                    durationMs: now() - startedAt
                });
                return res.status(201).json({ asset });
            } catch (error) {
                logger.error('media.cover_import.failed', {
                    requestId: req.requestId || 'not-provided',
                    userId: req.user.userId,
                    result: 'failure',
                    code: error && typeof error === 'object' && 'code' in error ? error.code : 'MEDIA_IMPORT_FAILED',
                    durationMs: now() - startedAt
                });
                return next(error);
            }
        },

        async deletePendingCover(req: Request, res: Response, next: NextFunction) {
            const assetId = Array.isArray(req.params.assetId) ? req.params.assetId[0] : req.params.assetId;
            if (!z.string().uuid().safeParse(assetId).success || !req.user?.userId) {
                return res.status(400).json({
                    error: 'Identificador de capa inválido.',
                    code: 'MEDIA_ASSET_ID_INVALID'
                });
            }
            try {
                await getRemovalService().removePending({ assetId, userId: req.user.userId });
                return res.status(204).end();
            } catch (error) {
                return next(error);
            }
        }
    };
}

const handlers = createAdminMediaHandlers({
    getImportService: getCoverImportService,
    getRemovalService: getCoverRemovalService
});

export = {
    ...handlers,
    createAdminMediaHandlers,
    importCoverSchema
};
