import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { PUBLIC_CATALOG_OPTION_CATEGORIES, PUBLIC_PUBLICATION_STATUSES, PUBLIC_WORK_DEMOGRAPHICS } from './constants';
import { canViewAdultContent, isRestrictedAdultOption } from './adultContentPolicy';
import { mapOption } from './mappers';

import { prepareViewerDependentResponse } from './response';

export { getPublicCatalogOptions };

const publicCatalogOptionSelect = {
    id: true,
    label: true,
    code: true,
    adultOnly: true,
    category: { select: { slug: true } },
} satisfies Prisma.DomainOptionValueSelect;

async function getPublicCatalogOptions(req: Request, res: Response, next: NextFunction) {
    const categorySlugs = Object.values(PUBLIC_CATALOG_OPTION_CATEGORIES);
    const viewerCanSeeAdultOptions = canViewAdultContent(req);

    try {
        const values = await prisma.domainOptionValue.findMany({
            where: {
                active: true,
                category: {
                    slug: { in: categorySlugs }
                }
            },
            select: publicCatalogOptionSelect,
            // `position` só é significativa em gêneros e tipos de Obra; nas demais
            // categorias ela é 0 e o rótulo decide.
            orderBy: [
                { position: 'asc' },
                { label: 'asc' },
                { id: 'asc' }
            ]
        });
        const visibleValues = values.filter((value) => (
            !isRestrictedAdultOption(value, viewerCanSeeAdultOptions)
        ));
        const valuesOf = (categorySlug: string) => visibleValues
            .filter((value) => value.category.slug === categorySlug);
        const valuesFor = (categorySlug: string) => valuesOf(categorySlug).map(mapOption);

        // A resposta depende da sessão: nunca pode ser reaproveitada por outra pessoa.
        prepareViewerDependentResponse(res);
        return res.status(200).json({
            options: {
                workTypes: valuesFor(PUBLIC_CATALOG_OPTION_CATEGORIES.workTypes),
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
