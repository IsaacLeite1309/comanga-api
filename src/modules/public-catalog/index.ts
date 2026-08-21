import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import {
    PUBLIC_CATALOG_OPTION_CATEGORIES,
    PUBLIC_WORK_COUNTRIES,
    PUBLIC_WORK_DEMOGRAPHICS
} from './constants';
import {
    mapOption,
    mapPublicEdition,
    mapPublicEditionDetails,
    mapPublicEditionVolume,
    mapPublicVolumeDetails,
    mapPublicWork,
    mapPublicWorkDetails
} from './mappers';
import {
    buildPublicEditionDetailWhere,
    buildPublicEditionOrderBy,
    buildPublicEditionWhere,
    buildPublicVolumeDetailWhere,
    buildPublicWorkOrderBy,
    buildPublicWorkWhere,
    publicEditionSelect,
    publicEditionDetailSelect,
    publicEditionVolumeSelect,
    publicVolumeDetailSelect,
    publicWorkSelect,
    publicWorkDetailSelect
} from './queries';
import {
    publicDetailsQuerySchema,
    publicEditionsQuerySchema,
    publicEntityIdParamsSchema,
    publicVolumeIdParamsSchema,
    publicWorksQuerySchema
} from './schemas';

const INVALID_PUBLIC_FILTERS_MESSAGE = 'Filtros de consulta inválidos.';
const INVALID_PUBLIC_PARAMETERS_MESSAGE = 'Parâmetros de consulta inválidos.';

function canViewAdultContent(req: Request): boolean {
    return req.publicCatalogViewer?.canViewAdultContent === true;
}

function pagination(page: number, limit: number, total: number) {
    return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
    };
}

function prepareViewerDependentResponse(res: Response) {
    res.vary('Cookie');
    res.set('Cache-Control', 'private, no-store');
}

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

async function getPublicWorkDetails(req: Request, res: Response, next: NextFunction) {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const where = {
        slug,
        visibility: 'Público',
        ...(!canViewAdultContent(req) ? { adultContent: false } : {})
    };

    try {
        const work = await prisma.work.findFirst({
            where,
            select: publicWorkDetailSelect
        });

        prepareViewerDependentResponse(res);
        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        return res.status(200).json({ work: mapPublicWorkDetails(work) });
    } catch (error) {
        return next(error);
    }
}

async function listPublicEditions(req: Request, res: Response, next: NextFunction) {
    const validation = publicEditionsQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_FILTERS_MESSAGE });
    }

    const query = validation.data;
    const where = buildPublicEditionWhere(query, canViewAdultContent(req));

    try {
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
    const paramsValidation = publicEntityIdParamsSchema.safeParse(req.params);
    const queryValidation = publicDetailsQuerySchema.safeParse(req.query);

    if (!paramsValidation.success || !queryValidation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_PARAMETERS_MESSAGE });
    }

    const { editionId } = paramsValidation.data;
    const { page, limit } = queryValidation.data;
    const editionWhere = buildPublicEditionDetailWhere(
        editionId,
        canViewAdultContent(req)
    );

    try {
        const [edition, volumes] = await prisma.$transaction([
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
            })
        ]);

        prepareViewerDependentResponse(res);
        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const total = edition._count.volumes;
        return res.status(200).json({
            edition: mapPublicEditionDetails(edition),
            volumes: volumes.map(mapPublicEditionVolume),
            pagination: pagination(page, limit, total)
        });
    } catch (error) {
        return next(error);
    }
}

async function getPublicVolumeDetails(req: Request, res: Response, next: NextFunction) {
    const validation = publicVolumeIdParamsSchema.safeParse(req.params);

    if (!validation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_PARAMETERS_MESSAGE });
    }

    const where = buildPublicVolumeDetailWhere(
        validation.data.volumeId,
        canViewAdultContent(req)
    );

    try {
        const volume = await prisma.volume.findFirst({
            where,
            select: publicVolumeDetailSelect
        });

        prepareViewerDependentResponse(res);
        if (!volume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }

        return res.status(200).json({ volume: mapPublicVolumeDetails(volume) });
    } catch (error) {
        return next(error);
    }
}

async function getPublicCatalogOptions(_req: Request, res: Response, next: NextFunction) {
    const categorySlugs = Object.values(PUBLIC_CATALOG_OPTION_CATEGORIES);

    try {
        const values = await prisma.domainOptionValue.findMany({
            where: {
                active: true,
                category: {
                    slug: { in: categorySlugs }
                }
            },
            select: {
                id: true,
                label: true,
                category: {
                    select: { slug: true }
                }
            },
            orderBy: [
                { label: 'asc' },
                { id: 'asc' }
            ]
        });

        const valuesFor = (categorySlug: string) => values
            .filter((value) => value.category.slug === categorySlug)
            .map(mapOption);

        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json({
            options: {
                workTypes: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.workTypes),
                countries: [...PUBLIC_WORK_COUNTRIES],
                demographics: [...PUBLIC_WORK_DEMOGRAPHICS],
                genres: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.genres),
                brazilianPublishers: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.brazilianPublishers),
                formats: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.formats),
                coverTypes: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.coverTypes)
            }
        });
    } catch (error) {
        return next(error);
    }
}

export {
    listPublicWorks,
    getPublicWorkDetails,
    listPublicEditions,
    getPublicEditionDetails,
    getPublicVolumeDetails,
    getPublicCatalogOptions
};
