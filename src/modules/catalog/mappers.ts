import { AUTHOR_ROLE_PRIORITY_VALUES } from './constants';

import type { EditionInput, OptionSummary, VolumeInput, WorkDetailInput, WorkSummaryInput } from './types';
import { mediaPublicUrlResolverFromEnvironment, resolveCoverUrl } from '../../infrastructure/media/mediaPublicUrl';

function normalizeCoverUrl(asset: WorkSummaryInput['coverAsset']) {
    if (!asset) return null;
    return resolveCoverUrl(asset, mediaPublicUrlResolverFromEnvironment());
}

function normalizeOptionSummary(value: OptionSummary | null | undefined) {
    if (!value) return null;

    return {
        id: value.id,
        label: value.label
    };
}

function getAuthorRolePriority(role: string) {
    const priority = AUTHOR_ROLE_PRIORITY_VALUES.findIndex((value) => value === role);
    return priority === -1 ? AUTHOR_ROLE_PRIORITY_VALUES.length : priority;
}

// A ordem dos creditos e a posicao editorial persistida; os papeis nao a definem.
function sortAuthorsByPosition<T extends { position?: number }>(authors: T[]) {
    return authors
        .map((author, index) => ({ author, index }))
        .sort((firstAuthor, secondAuthor) => (
            (firstAuthor.author.position ?? firstAuthor.index) - (secondAuthor.author.position ?? secondAuthor.index)
            || firstAuthor.index - secondAuthor.index
        ))
        .map((item) => item.author);
}

function sortAuthorsByCredit<T extends { author: OptionSummary; roles?: Array<{ role: string }> }>(authors: T[]) {
    return [...authors].sort((firstAuthor, secondAuthor) => {
        const firstPriority = Math.min(...(firstAuthor.roles || []).map((item) => getAuthorRolePriority(item.role)));
        const secondPriority = Math.min(...(secondAuthor.roles || []).map((item) => getAuthorRolePriority(item.role)));
        return firstPriority - secondPriority
            || firstAuthor.author.label.localeCompare(secondAuthor.author.label, 'pt-BR', { sensitivity: 'base' });
    });
}

function normalizeOrderedAuthors<T extends { position?: number }>(authors: T[]) {
    return authors.map((author, index) => ({ ...author, position: index }));
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
        romanizedTitle: work.romanizedTitle,
        type: normalizeOptionSummary(work.type),
        country: work.country,
        visibility: work.visibility,
        adultContent: work.adultContent,
        coverAssetId: work.coverAssetId,
        coverUrl: normalizeCoverUrl(work.coverAsset),
        editionsCount: work.editionsCount ?? work._count?.editions ?? 0,
        authors: sortAuthorsByCredit(work.authors || []).map((item) => normalizeOptionSummary(item.author))
    };
}

function normalizeWorkDetail(work: WorkDetailInput) {
    return {
        ...normalizeWorkSummary(work),
        synopsis: work.synopsis,
        originalPublicationStartYear: work.originalPublicationStartYear,
        originalPublicationEndYear: work.originalPublicationEndYear,
        originalVolumeCount: work.originalVolumeCount,
        directRelease: work.directRelease,
        originalPublishers: work.originalPublishers?.map((item) => normalizeOptionSummary(item.publisher)) || [],
        originalPublicationStatus: work.originalPublicationStatus,
        authors: sortAuthorsByCredit(work.authors || []).map((item) => ({
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
        coverAssetId: edition.coverAssetId,
        coverUrl: normalizeCoverUrl(edition.coverAsset),
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
        coverAssetId: volume.coverAssetId,
        coverUrl: normalizeCoverUrl(volume.coverAsset),
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
    normalizeOptionSummary,
    getAuthorRolePriority,
    sortAuthorsByPosition,
    sortAuthorsByCredit,
    normalizeOrderedAuthors,
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
