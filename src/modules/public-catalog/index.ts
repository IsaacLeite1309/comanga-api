import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import type { PublicCoverAssetInput } from './types';
import {
    PUBLIC_AUTHOR_CATEGORY,
    PUBLIC_CATALOG_OPTION_CATEGORIES,
    PUBLIC_PUBLICATION_STATUSES,
    PUBLIC_VISIBILITY,
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
    buildPublicEditionCoverSourceWhere,
    buildPublicEditionDetailWhere,
    buildPublicEditionOrderBy,
    buildPublicEditionWhere,
    buildPublicAuthorWorksWhere,
    buildPublicVolumeDetailWhere,
    buildPublicWorkOrderBy,
    buildPublicWorkWhere,
    publicEditionCoverSourceVolumeSelect,
    publicEditionSelect,
    publicEditionDetailSelect,
    publicEditionVolumeSelect,
    publicVolumeDetailSelect,
    publicWorkSelect,
    publicWorkDetailSelect
} from './queries';
import {
    publicAuthorIdParamsSchema,
    publicAuthorWorksQuerySchema,
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

async function listPublicAuthorWorks(req: Request, res: Response, next: NextFunction) {
    const paramsValidation = publicAuthorIdParamsSchema.safeParse(req.params);
    const queryValidation = publicAuthorWorksQuerySchema.safeParse(req.query);

    if (!paramsValidation.success || !queryValidation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_PARAMETERS_MESSAGE });
    }

    const { authorId } = paramsValidation.data;
    const query = queryValidation.data;
    const where = buildPublicAuthorWorksWhere(authorId, canViewAdultContent(req));

    try {
        const [author, works, total] = await prisma.$transaction([
            prisma.domainOptionValue.findFirst({
                where: { id: authorId, category: { slug: PUBLIC_AUTHOR_CATEGORY } },
                select: { id: true, label: true }
            }),
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
        if (!author) {
            return res.status(404).json({ error: 'Autor não encontrado.' });
        }

        return res.status(200).json({
            author: mapOption(author),
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

        const editionCoverAssets = await findEditionCoverAssets(work.editions.map((edition) => edition.id));

        return res.status(200).json({ work: mapPublicWorkDetails(work, editionCoverAssets) });
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

        prepareViewerDependentResponse(res);
        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const total = edition._count.volumes;
        const publicEdition = mapPublicEditionDetails(edition);
        return res.status(200).json({
            edition: {
                ...publicEdition,
                brazilPublicationStartYear: firstPublicationVolume?.releaseYear ?? null,
                brazilPublicationEndYear: publicEdition.brazilPublicationStatus === 'Completa'
                    ? lastPublicationVolume?.releaseYear ?? null
                    : null
            },
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
                originalPublishers: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.originalPublishers),
                serializationMagazines: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.serializationMagazines),
                originalPublicationStatuses: [...PUBLIC_PUBLICATION_STATUSES],
                brazilianPublishers: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.brazilianPublishers),
                brazilPublicationStatuses: [...PUBLIC_PUBLICATION_STATUSES],
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
    listPublicAuthorWorks,
    getPublicWorkDetails,
    listPublicEditions,
    getPublicEditionDetails,
    getPublicVolumeDetails,
    getPublicCatalogOptions
};
