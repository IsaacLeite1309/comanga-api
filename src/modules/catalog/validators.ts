import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import {
    GENRES_WITHOUT_DEMOGRAPHY_FILTER,
    HENTAI_GENRE_FILTER,
    isSystemManagedOptionCategory
} from '../../utils/domainOptionCodes';
import {
    EDITION_FORM_OPTION_CATEGORIES,
    WORK_DOMAIN_CATEGORIES
} from './constants';

async function validateOptionIdsByCategory(
    categorySlug: string, ids: number[], existingIds: number[] = [], client: Prisma.TransactionClient = prisma
) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];

    if (uniqueIds.length === 0) {
        return true;
    }

    const count = await client.domainOptionValue.count({
        where: {
            id: { in: uniqueIds },
            ...(isSystemManagedOptionCategory(categorySlug)
                ? { OR: [{ systemManaged: true, active: true }, { id: { in: existingIds } }] }
                : { active: true }),
            category: {
                slug: categorySlug
            }
        }
    });

    return count === uniqueIds.length;
}

async function validateEditionDomainReferences(data: {
    brazilianPublisherId?: number;
    coverTypeId?: number | null;
    formatId?: number | null;
    paperIds?: number[];
}) {
    const validations: Array<Promise<boolean>> = [];

    if (data.brazilianPublisherId) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.brazilianPublishers, [data.brazilianPublisherId]));
    }


    if (data.coverTypeId) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.coverTypes, [data.coverTypeId]));
    }

    if (data.formatId) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.formats, [data.formatId]));
    }

    if (data.paperIds && data.paperIds.length > 0) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.papers, data.paperIds));
    }

    const results = await Promise.all(validations);
    return results.every(Boolean);
}

async function validateWorkDomainReferences(data: {
    typeId: number;
    originalPublisherIds?: number[];
    authors: Array<{ authorId: number; roles: string[] }>;
    genreIds: number[];
    magazineIds: number[];
}) {
    const validations = await Promise.all([
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.typeId, [data.typeId]),
        data.originalPublisherIds && data.originalPublisherIds.length > 0
            ? validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.originalPublishers, data.originalPublisherIds)
            : Promise.resolve(true),
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.authorId, data.authors.map((author) => author.authorId)),
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.genreIds, data.genreIds),
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.magazineIds, data.magazineIds)
    ]);

    if (!validations.every(Boolean)) {
        return false;
    }

    return true;
}

function parsePositiveId(value: string | string[] | undefined) {
    if (Array.isArray(value) || value === undefined) return null;

    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

// Identidade estável do gênero Hentai: nenhuma consulta compara o rótulo textual.
async function containsHentaiGenre(genreIds: number[], client: Prisma.TransactionClient = prisma) {
    const uniqueIds = [...new Set(genreIds.filter(Boolean))];

    if (uniqueIds.length === 0) return false;

    const hentaiCount = await client.domainOptionValue.count({
        where: {
            id: { in: uniqueIds },
            ...HENTAI_GENRE_FILTER
        }
    });

    return hentaiCount > 0;
}

async function containsGenreWithoutDemography(genreIds: number[], client: Prisma.TransactionClient = prisma) {
    const uniqueIds = [...new Set(genreIds.filter(Boolean))];
    if (uniqueIds.length === 0) return false;

    return (await client.domainOptionValue.count({
        where: { id: { in: uniqueIds }, ...GENRES_WITHOUT_DEMOGRAPHY_FILTER }
    })) > 0;
}

async function workHasHentaiGenre(workId: number, client: Prisma.TransactionClient = prisma) {
    const genre = await client.workGenre.findFirst({
        where: {
            workId,
            genre: HENTAI_GENRE_FILTER
        },
        select: { genreId: true }
    });

    return Boolean(genre);
}

export {
    containsHentaiGenre,
    containsGenreWithoutDemography,
    workHasHentaiGenre,
    validateOptionIdsByCategory,
    validateEditionDomainReferences,
    validateWorkDomainReferences,
    parsePositiveId
};
