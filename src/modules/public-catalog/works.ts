import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import type { PublicCoverAssetInput } from './types';
import { enrichPublicWork, loadPersonalCatalogState } from './personalState';
import { buildAdultWorkRestriction, canViewAdultContent } from './adultContentPolicy';
import { mapPublicWork, mapPublicWorkDetails } from './mappers';
import { buildPublicEditionCoverSourceWhere, buildPublicWorkOrderBy, buildPublicWorkWhere, publicEditionCoverSourceVolumeSelect, publicWorkSelect, publicWorkDetailSelect } from './queries';
import { publicWorksQuerySchema } from './schemas';

import { INVALID_PUBLIC_FILTERS_MESSAGE, pagination, prepareViewerDependentResponse } from './response';

export { listPublicWorks, getPublicWorkDetails };

async function listPublicWorks(req: Request, res: Response, next: NextFunction) {
    const validation = publicWorksQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_FILTERS_MESSAGE });
    }

    const query = validation.data;
    const where = buildPublicWorkWhere(query, canViewAdultContent(req));

    try {
        const [works, total] = await prisma.$transaction([
            prisma.work.findMany({
                where,
                select: publicWorkSelect,
                orderBy: buildPublicWorkOrderBy(query.sortBy, query.order),
                skip: (query.page - 1) * query.limit,
                take: query.limit
            }),
            prisma.work.count({ where })
        ]);

        prepareViewerDependentResponse(res);
        return res.status(200).json({
            works: works.map(mapPublicWork),
            pagination: pagination(query.page, query.limit, total)
        });
    } catch (error) {
        return next(error);
    }
}

// A capa de cada Edição vem do Volume 1 público da própria Edição, nunca de outra.
async function findEditionCoverAssets(editionIds: number[]) {
    if (editionIds.length === 0) return new Map<number, PublicCoverAssetInput | null>();

    const coverSourceVolumes = await prisma.volume.findMany({
        where: buildPublicEditionCoverSourceWhere(editionIds),
        select: publicEditionCoverSourceVolumeSelect
    });

    return new Map<number, PublicCoverAssetInput | null>(
        coverSourceVolumes.map((volume) => [volume.editionId, volume.coverAsset])
    );
}

async function getPublicWorkDetails(req: Request, res: Response, next: NextFunction) {
    prepareViewerDependentResponse(res);
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const where = {
        slug,
        visibility: 'Público',
        ...buildAdultWorkRestriction(canViewAdultContent(req))
    };

    try {
        const work = await prisma.work.findFirst({
            where,
            select: publicWorkDetailSelect
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        const editionCoverAssets = await findEditionCoverAssets(work.editions.map((edition) => edition.id));
        const personal = await loadPersonalCatalogState(req, { workId: work.id });
        return res.status(200).json({ work: enrichPublicWork(mapPublicWorkDetails(work, editionCoverAssets), personal) });
    } catch (error) {
        return next(error);
    }
}
