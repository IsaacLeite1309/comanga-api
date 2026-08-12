import { AUTHOR_ROLE_VALUES } from './constants';
import type { EditionInput, OptionSummary, VolumeInput, WorkDetailInput, WorkSummaryInput } from './types';

function normalizeUser(user: {
    id: string;
    username: string;
    email: string;
    nivelAcesso: string;
    status: string;
}) {
    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        role: user.nivelAcesso,
        status: user.status
    };
}

function normalizeOptionValue(value: {
    id: number;
    label: string;
    category: {
        slug: string;
        name: string;
    };
    dependencies?: Array<{
        dependsOnValue: {
            id: number;
            label: string;
            category: {
                slug: string;
                name: string;
            };
        };
    }>;
}) {
    return {
        id: value.id,
        label: value.label,
        category: {
            slug: value.category.slug,
            name: value.category.name
        },
        depends_on: value.dependencies?.map((dependency) => ({
            id: dependency.dependsOnValue.id,
            label: dependency.dependsOnValue.label,
            category: {
                slug: dependency.dependsOnValue.category.slug,
                name: dependency.dependsOnValue.category.name
            }
        })) || []
    };
}

function normalizeOptionSummary(value: OptionSummary | null | undefined) {
    if (!value) return null;

    return {
        id: value.id,
        label: value.label
    };
}

function getAuthorRolePriority(role: string) {
    const priority = AUTHOR_ROLE_VALUES.findIndex((value) => value === role);
    return priority === -1 ? AUTHOR_ROLE_VALUES.length : priority;
}

function getAuthorHighestRolePriority(author: { roles?: Array<{ role: string }> }) {
    if (!author.roles || author.roles.length === 0) return AUTHOR_ROLE_VALUES.length;

    return Math.min(...author.roles.map((role) => getAuthorRolePriority(role.role)));
}

function sortAuthorsByRolePriority<T extends { roles?: Array<{ role: string }>; author: OptionSummary }>(authors: T[]) {
    return [...authors].sort((firstAuthor, secondAuthor) => {
        const priorityDifference = getAuthorHighestRolePriority(firstAuthor) - getAuthorHighestRolePriority(secondAuthor);

        if (priorityDifference !== 0) return priorityDifference;

        return firstAuthor.author.label.localeCompare(secondAuthor.author.label, 'pt-BR', { sensitivity: 'base' });
    });
}

function normalizeAuthorRoles(roles?: Array<{ role: string }>) {
    return [...(roles || [])]
        .map((item) => item.role)
        .sort((firstRole, secondRole) => getAuthorRolePriority(firstRole) - getAuthorRolePriority(secondRole));
}

function hasDuplicatedStrings(values: string[]) {
    return new Set(values).size !== values.length;
}

function isPublicVisibility(visibility: string) {
    return visibility === 'Público';
}

function normalizeVisibility(visibility: string) {
    return isPublicVisibility(visibility) ? 'Público' : 'Privado';
}

function normalizeWorkSummary(work: WorkSummaryInput) {
    return {
        id: work.id,
        slug: work.slug,
        title: work.title,
        originalTitle: work.originalTitle,
        type: normalizeOptionSummary(work.type),
        country: work.country,
        visibility: work.visibility,
        adultContent: work.adultContent,
        coverUrl: work.coverUrl,
        editionsCount: work.editionsCount ?? work._count?.editions ?? 0,
        authors: sortAuthorsByRolePriority(work.authors || []).map((item) => normalizeOptionSummary(item.author))
    };
}

function normalizeWorkDetail(work: WorkDetailInput) {
    return {
        ...normalizeWorkSummary(work),
        originalPublicationStartYear: work.originalPublicationStartYear,
        originalPublicationEndYear: work.originalPublicationEndYear,
        originalVolumeCount: work.originalVolumeCount,
        directRelease: work.directRelease,
        originalPublishers: work.originalPublishers?.map((item) => normalizeOptionSummary(item.publisher)) || [],
        originalPublicationStatus: work.originalPublicationStatus,
        authors: sortAuthorsByRolePriority(work.authors || []).map((item) => ({
            author: normalizeOptionSummary(item.author),
            roles: normalizeAuthorRoles(item.roles)
        })) || [],
        genres: work.genres?.map((item) => normalizeOptionSummary(item.genre)) || [],
        demographics: work.demographics?.map((item) => item.demography) || [],
        serializationMagazines: work.serializationMagazines?.map((item) => normalizeOptionSummary(item.magazine)) || []
    };
}

function normalizeEdition(edition: EditionInput) {
    return {
        id: edition.id,
        workId: edition.workId,
        chronologicalNumber: edition.chronologicalNumber,
        coverUrl: edition.coverUrl,
        visibility: edition.visibility,
        brazilianPublisher: normalizeOptionSummary(edition.brazilianPublisher),
        editionType: normalizeOptionSummary(edition.editionType),
        coverType: normalizeOptionSummary(edition.coverType),
        format: normalizeOptionSummary(edition.format),
        brazilPublicationStatus: edition.brazilPublicationStatus,
        volumesCount: edition._count?.volumes ?? 0
    };
}

function normalizeVolume(volume: VolumeInput) {
    return {
        id: volume.id,
        editionId: volume.editionId,
        number: volume.number,
        coverUrl: volume.coverUrl,
        singleVolume: volume.singleVolume,
        pages: volume.pages,
        price: volume.price === null || volume.price === undefined ? null : Number(volume.price),
        priceCurrency: volume.priceCurrency,
        releaseDatePrecision: volume.releaseDatePrecision,
        releaseYear: volume.releaseYear,
        releaseMonth: volume.releaseMonth,
        releaseDay: volume.releaseDay,
        isbn10: volume.isbn10,
        isbn13: volume.isbn13,
        affiliateLink: volume.affiliateLink,
        synopsis: volume.synopsis,
        visibility: volume.visibility
    };
}

function normalizeOrderedIds(values?: Array<number | { id: number; position?: number }>) {
    return (values || [])
        .map((value, index) => (
            typeof value === 'number'
                ? { id: value, position: index }
                : { id: value.id, position: value.position ?? index }
        ))
        .sort((firstValue, secondValue) => firstValue.position - secondValue.position)
        .map((value, index) => ({ ...value, position: index }));
}

function getOrderedIds(values: Array<{ id: number; position: number }>) {
    return values.map((value) => value.id);
}

function findDuplicatedNumbers(values: number[]) {
    const seenValues = new Set<number>();
    const duplicatedValues = new Set<number>();

    values.forEach((value) => {
        if (seenValues.has(value)) {
            duplicatedValues.add(value);
            return;
        }

        seenValues.add(value);
    });

    return [...duplicatedValues];
}

export {
    normalizeUser,
    normalizeOptionValue,
    normalizeOptionSummary,
    getAuthorRolePriority,
    getAuthorHighestRolePriority,
    sortAuthorsByRolePriority,
    normalizeAuthorRoles,
    hasDuplicatedStrings,
    isPublicVisibility,
    normalizeVisibility,
    normalizeWorkSummary,
    normalizeWorkDetail,
    normalizeEdition,
    normalizeVolume,
    normalizeOrderedIds,
    getOrderedIds,
    findDuplicatedNumbers
};
