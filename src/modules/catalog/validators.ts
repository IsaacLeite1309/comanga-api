import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { HENTAI_GENRE_FILTER, isSystemManagedOptionCategory } from '../../utils/domainOptionCodes';
import {
    COUNTRY_CATEGORY_SLUG,
    COUNTRY_DEPENDENCY_MANDATORY_CATEGORY_SLUGS,
    COUNTRY_DEPENDENT_CATEGORY_SLUGS,
    EDITION_FORM_OPTION_CATEGORIES,
    WORK_DOMAIN_CATEGORIES
} from './constants';

async function validateSelectedOptionsByCountry(
    selections: Array<{ categorySlug: string; ids: number[] }>,
    country: string,
    client: Prisma.TransactionClient = prisma
) {
    const countryDependentSelections = selections
        .filter((selection) => COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(selection.categorySlug))
        .map((selection) => ({
            ...selection,
            ids: [...new Set(selection.ids.filter(Boolean))]
        }))
        .filter((selection) => selection.ids.length > 0);

    if (countryDependentSelections.length === 0) return true;

    const optionIds = countryDependentSelections.flatMap((selection) => selection.ids);
    const values = await client.domainOptionValue.findMany({
        // Vínculos inativos preservados também precisam respeitar o país.
        where: { id: { in: optionIds } },
        select: {
            id: true,
            dependencies: {
                select: {
                    dependsOnValue: {
                        select: {
                            label: true,
                            category: { select: { slug: true } }
                        }
                    }
                }
            }
        }
    });
    const valuesById = new Map(values.map((value) => [value.id, value]));

    return countryDependentSelections.every((selection) => {
        const dependencyIsMandatory = COUNTRY_DEPENDENCY_MANDATORY_CATEGORY_SLUGS.has(selection.categorySlug);

        return selection.ids.every((id) => {
            const value = valuesById.get(id);
            if (!value) return true;
            const countryDependencies = value.dependencies.filter((dependency) => (
                dependency.dependsOnValue.category.slug === COUNTRY_CATEGORY_SLUG
            ));

            if (countryDependencies.some((dependency) => dependency.dependsOnValue.label === country)) {
                return true;
            }

            // Sem dependência declarada, só as categorias não obrigatórias passam.
            return !dependencyIsMandatory && countryDependencies.length === 0;
        });
    });
}

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
    country: string;
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

    return validateSelectedOptionsByCountry([
        { categorySlug: WORK_DOMAIN_CATEGORIES.typeId, ids: [data.typeId] },
        { categorySlug: WORK_DOMAIN_CATEGORIES.authorId, ids: data.authors.map((author) => author.authorId) },
        { categorySlug: WORK_DOMAIN_CATEGORIES.originalPublishers, ids: data.originalPublisherIds || [] },
        { categorySlug: WORK_DOMAIN_CATEGORIES.magazineIds, ids: data.magazineIds }
    ], data.country);
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
    workHasHentaiGenre,
    validateSelectedOptionsByCountry,
    validateOptionIdsByCategory,
    validateEditionDomainReferences,
    validateWorkDomainReferences,
    parsePositiveId
};
