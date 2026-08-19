import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import {
    PUBLIC_CATALOG_OPTION_CATEGORIES,
    PUBLIC_WORK_COUNTRIES,
    PUBLIC_WORK_DEMOGRAPHICS
} from './constants';
import { mapOption, mapPublicEdition, mapPublicWork } from './mappers';
import {
    buildPublicEditionOrderBy,
    buildPublicEditionWhere,
    buildPublicWorkOrderBy,
    buildPublicWorkWhere,
    publicEditionSelect,
    publicWorkSelect
} from './queries';
import { publicEditionsQuerySchema, publicWorksQuerySchema } from './schemas';

const INVALID_PUBLIC_FILTERS_MESSAGE = 'Filtros de consulta inválidos.';

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
    listPublicEditions,
    getPublicCatalogOptions
};
