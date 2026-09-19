import prisma from '../../prisma';
import {
    COUNTRY_CATEGORY_SLUG,
    COUNTRY_DEPENDENCY_REQUIRED_MESSAGE,
    COUNTRY_DEPENDENT_CATEGORY_SLUGS,
    LISTABLE_OPTION_CATEGORY_SLUGS,
    MANAGEABLE_OPTION_CATEGORY_SLUGS
} from './constants';

function isManageableOptionCategory(slug: string) {
    return MANAGEABLE_OPTION_CATEGORY_SLUGS.has(slug);
}

function isListableOptionCategory(slug: string) {
    return LISTABLE_OPTION_CATEGORY_SLUGS.has(slug);
}

async function findCategoryBySlug(slug: string) {
    if (!isManageableOptionCategory(slug)) return null;

    return prisma.domainOptionCategory.findUnique({
        where: { slug }
    });
}

async function findListableCategoryBySlug(slug: string) {
    if (!isListableOptionCategory(slug)) return null;

    return prisma.domainOptionCategory.findUnique({
        where: { slug }
    });
}

async function optionLabelExists(categoryId: number, label: string, ignoredValueId?: number) {
    const value = await prisma.domainOptionValue.findFirst({
        where: {
            categoryId,
            label: {
                equals: label,
                mode: 'insensitive'
            },
            ...(ignoredValueId ? { id: { not: ignoredValueId } } : {})
        },
        select: { id: true }
    });

    return Boolean(value);
}

function parseOptionLabels(label: string) {
    return label
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseOptionLabelsForCategory(label: string, categorySlug: string) {
    if (categorySlug === 'formatos-fisicos') {
        return [label.trim()].filter(Boolean);
    }

    return parseOptionLabels(label);
}

function findDuplicateSubmittedLabels(labels: string[]) {
    const seenLabels = new Map<string, string>();
    const duplicatedLabels = new Set<string>();

    labels.forEach((label) => {
        const normalizedLabel = label.toLocaleLowerCase('pt-BR');

        if (seenLabels.has(normalizedLabel)) {
            duplicatedLabels.add(seenLabels.get(normalizedLabel) || label);
            return;
        }

        seenLabels.set(normalizedLabel, label);
    });

    return [...duplicatedLabels];
}

async function findExistingOptionLabels(categoryId: number, labels: string[]) {
    const values = await prisma.domainOptionValue.findMany({
        where: {
            categoryId,
            OR: labels.map((label) => ({
                label: {
                    equals: label,
                    mode: 'insensitive' as const
                }
            }))
        },
        select: { label: true }
    });

    return values.map((value) => value.label);
}

function formatSubmittedDuplicateMessage(labels: string[]) {
    return `Valores repetidos na solicitação: ${labels.join(', ')}.`;
}

function formatExistingDuplicateMessage(labels: string[]) {
    if (labels.length === 1) {
        return `Essa lista já tem esse valor cadastrado: ${labels[0]}.`;
    }

    return `Essa lista já tem esses valores cadastrados: ${labels.join(', ')}.`;
}

async function validateCountryDependencies(categorySlug: string, dependsOnValueIds: number[]) {
    const uniqueIds = [...new Set(dependsOnValueIds)];

    if (!COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(categorySlug)) {
        return [];
    }

    if (uniqueIds.length === 0) {
        return { error: COUNTRY_DEPENDENCY_REQUIRED_MESSAGE };
    }

    const countries = await prisma.domainOptionValue.findMany({
        where: {
            id: { in: uniqueIds },
            active: true,
            category: {
                slug: COUNTRY_CATEGORY_SLUG
            }
        },
        select: { id: true }
    });

    if (countries.length !== uniqueIds.length) {
        return { error: 'País de origem relacionado inválido.' };
    }

    return uniqueIds;
}

async function validateSelectedOptionsByCountry(
    selections: Array<{ categorySlug: string; ids: number[] }>,
    country: string
) {
    const countryDependentSelections = selections
        .filter((selection) => COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(selection.categorySlug))
        .map((selection) => ({
            ...selection,
            ids: [...new Set(selection.ids.filter(Boolean))]
        }))
        .filter((selection) => selection.ids.length > 0);

    if (countryDependentSelections.length === 0) {
        return true;
    }

    const optionIds = countryDependentSelections.flatMap((selection) => selection.ids);
    const values = await prisma.domainOptionValue.findMany({
        where: {
            id: { in: optionIds },
            active: true
        },
        select: {
            id: true,
            dependencies: {
                select: {
                    dependsOnValue: {
                        select: {
                            label: true,
                            category: {
                                select: {
                                    slug: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    const valuesById = new Map(values.map((value) => [value.id, value]));

    return countryDependentSelections.every((selection) => selection.ids.every((id) => {
        const value = valuesById.get(id);
        if (!value) return true;

        const countryDependencies = value.dependencies.filter((dependency) => (
            dependency.dependsOnValue.category.slug === COUNTRY_CATEGORY_SLUG
        ));

        if (countryDependencies.length === 0) return true;

        return countryDependencies.some((dependency) => (
            dependency.dependsOnValue.label === country
        ));
    }));
}

export {
    isManageableOptionCategory,
    isListableOptionCategory,
    findCategoryBySlug,
    findListableCategoryBySlug,
    optionLabelExists,
    parseOptionLabels,
    parseOptionLabelsForCategory,
    findDuplicateSubmittedLabels,
    findExistingOptionLabels,
    formatSubmittedDuplicateMessage,
    formatExistingDuplicateMessage,
    validateCountryDependencies,
    validateSelectedOptionsByCountry
};
