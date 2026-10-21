import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { loadPersonalCatalogState, personalSummaryFields, personalVolumeFields } from './personalState';
import { PUBLIC_VISIBILITY } from './constants';
import { buildAdultWorkRestriction, canViewAdultContent } from './adultContentPolicy';
import { mapPublicEdition, mapPublicEditionDetails, mapPublicEditionVolume } from './mappers';
import { buildPublicEditionDetailWhere, buildPublicEditionOrderBy, buildPublicEditionWhere, publicEditionSelect, publicEditionDetailSelect, publicEditionVolumeSelect } from './queries';
import { publicDetailsQuerySchema, publicEditionsQuerySchema, publicEntityIdParamsSchema, publicEditionContextParamsSchema } from './schemas';

import { INVALID_PUBLIC_FILTERS_MESSAGE, INVALID_PUBLIC_PARAMETERS_MESSAGE, pagination, prepareViewerDependentResponse } from './response';

export { listPublicEditions, getPublicEditionDetails };

async function findEditionIdsByPublicationYears(query: {
    brazilPublicationStartYear?: number;
    brazilPublicationEndYear?: number;
}): Promise<number[] | undefined> {
    const conditions: Prisma.Sql[] = [];

    if (query.brazilPublicationStartYear) {
        conditions.push(Prisma.sql`(
            SELECT volume.release_year
            FROM volumes AS volume
            WHERE volume.edition_id = edition.id
              AND volume.visibility = ${PUBLIC_VISIBILITY}
              AND volume.release_year IS NOT NULL
            ORDER BY volume.number ASC, volume.id ASC
            LIMIT 1
        ) = ${query.brazilPublicationStartYear}`);
    }

    if (query.brazilPublicationEndYear) {
        conditions.push(Prisma.sql`edition.brazil_publication_status = 'Completa'`);
        conditions.push(Prisma.sql`(
            SELECT volume.release_year
            FROM volumes AS volume
            WHERE volume.edition_id = edition.id
              AND volume.visibility = ${PUBLIC_VISIBILITY}
              AND volume.release_year IS NOT NULL
            ORDER BY volume.number DESC, volume.id DESC
            LIMIT 1
        ) = ${query.brazilPublicationEndYear}`);
    }

    if (conditions.length === 0) return undefined;

    const editions = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT edition.id
        FROM editions AS edition
        WHERE ${Prisma.join(conditions, ' AND ')}
    `);

    return editions.map((edition) => edition.id);
}

async function listPublicEditions(req: Request, res: Response, next: NextFunction) {
    const validation = publicEditionsQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_FILTERS_MESSAGE });
    }

    const query = validation.data;

    try {
        const publicationYearEditionIds = await findEditionIdsByPublicationYears(query);
        const where: Prisma.EditionWhereInput = {
            ...buildPublicEditionWhere(query, canViewAdultContent(req)),
            ...(publicationYearEditionIds ? { id: { in: publicationYearEditionIds } } : {})
        };
        const [editions, total] = await prisma.$transaction([
            prisma.edition.findMany({
                where,
                select: publicEditionSelect,
                orderBy: buildPublicEditionOrderBy(query.sortBy, query.order),
                skip: (query.page - 1) * query.limit,
                take: query.limit
            }),
            prisma.edition.count({ where })
        ]);

        prepareViewerDependentResponse(res);
        return res.status(200).json({
            editions: editions.map(mapPublicEdition),
            pagination: pagination(query.page, query.limit, total)
        });
    } catch (error) {
        return next(error);
    }
}

async function getPublicEditionDetails(req: Request, res: Response, next: NextFunction) {
    prepareViewerDependentResponse(res);
    const contextual = req.params.slug !== undefined;
    const paramsValidation = contextual
        ? publicEditionContextParamsSchema.safeParse(req.params)
        : publicEntityIdParamsSchema.safeParse(req.params);
    const queryValidation = publicDetailsQuerySchema.safeParse(req.query);

    if (!paramsValidation.success || !queryValidation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_PARAMETERS_MESSAGE });
    }

    const { page, limit } = queryValidation.data;
    const editionWhere: Prisma.EditionWhereInput = contextual
        ? {
            chronologicalNumber: Number(req.params.editionNumber),
            visibility: PUBLIC_VISIBILITY,
            work: {
                slug: Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug,
                visibility: PUBLIC_VISIBILITY,
                ...buildAdultWorkRestriction(canViewAdultContent(req))
            }
        }
        : buildPublicEditionDetailWhere(Number(req.params.editionId), canViewAdultContent(req));

    try {
        const [edition, volumes, firstPublicationVolume, lastPublicationVolume] = await prisma.$transaction([
            prisma.edition.findFirst({
                where: editionWhere,
                select: publicEditionDetailSelect
            }),
            prisma.volume.findMany({
                where: {
                    visibility: 'Público',
                    edition: editionWhere
                },
                select: publicEditionVolumeSelect,
                orderBy: [{ number: 'asc' }, { id: 'asc' }],
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.volume.findFirst({
                where: {
                    visibility: 'Público',
                    edition: editionWhere
                },
                select: { releaseYear: true },
                orderBy: [{ number: 'asc' }, { id: 'asc' }]
            }),
            prisma.volume.findFirst({
                where: {
                    visibility: 'Público',
                    edition: editionWhere
                },
                select: { releaseYear: true },
                orderBy: [{ number: 'desc' }, { id: 'desc' }]
            })
        ]);

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const total = edition._count.volumes;
        const publicEdition = mapPublicEditionDetails(edition);
        const personal = await loadPersonalCatalogState(req, { editionId: edition.id });
        return res.status(200).json({
            edition: {
                ...publicEdition,
                ...personalSummaryFields(personal),
                brazilPublicationStartYear: firstPublicationVolume?.releaseYear ?? null,
                brazilPublicationEndYear: publicEdition.brazilPublicationStatus === 'Completa'
                    ? lastPublicationVolume?.releaseYear ?? null
                    : null
            },
            volumes: volumes.map(volume => ({ ...mapPublicEditionVolume(volume), ...personalVolumeFields(personal, volume.id) })),
            pagination: pagination(page, limit, total)
        });
    } catch (error) {
        return next(error);
    }
}
