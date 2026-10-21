import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { loadPersonalCatalogState, personalVolumeFields } from './personalState';
import { PUBLIC_VISIBILITY } from './constants';
import { buildAdultWorkRestriction, canViewAdultContent } from './adultContentPolicy';
import { mapPublicVolumeDetails } from './mappers';
import { buildPublicVolumeDetailWhere, publicVolumeDetailSelect } from './queries';
import { publicVolumeIdParamsSchema, publicVolumeContextParamsSchema } from './schemas';

import { INVALID_PUBLIC_PARAMETERS_MESSAGE, prepareViewerDependentResponse } from './response';

export { getPublicVolumeDetails };

async function getPublicVolumeDetails(req: Request, res: Response, next: NextFunction) {
    prepareViewerDependentResponse(res);
    const contextual = req.params.slug !== undefined;
    const validation = contextual
        ? publicVolumeContextParamsSchema.safeParse(req.params)
        : publicVolumeIdParamsSchema.safeParse(req.params);

    if (!validation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_PARAMETERS_MESSAGE });
    }

    const where: Prisma.VolumeWhereInput = contextual
        ? {
            number: Number(req.params.volumeNumber),
            visibility: PUBLIC_VISIBILITY,
            edition: {
                chronologicalNumber: Number(req.params.editionNumber),
                visibility: PUBLIC_VISIBILITY,
                work: {
                    slug: Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug,
                    visibility: PUBLIC_VISIBILITY,
                    ...buildAdultWorkRestriction(canViewAdultContent(req))
                }
            }
        }
        : buildPublicVolumeDetailWhere(Number(req.params.volumeId), canViewAdultContent(req));

    try {
        const volume = await prisma.volume.findFirst({
            where,
            select: publicVolumeDetailSelect
        });

        if (!volume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }
        const personal = await loadPersonalCatalogState(req, { volumeId: volume.id });
        return res.status(200).json({ volume: { ...mapPublicVolumeDetails(volume), ...personalVolumeFields(personal, volume.id) } });
    } catch (error) {
        return next(error);
    }
}
