import { findDuplicatedNumbers, hasDuplicatedStrings } from '../shared';

export { hasDuplicatedWorkRelations, hasInvalidPublicationPeriod };

function hasDuplicatedWorkRelations(
    data: {
        genreIds?: number[];
        authors?: Array<{ roles: string[] }>;
    },
    demographies: string[] | undefined,
    magazineIds: number[] | undefined,
    originalPublisherIds: number[] | undefined
) {
    return Boolean(
        (data.genreIds && findDuplicatedNumbers(data.genreIds).length > 0)
        || (demographies && hasDuplicatedStrings(demographies))
        || (magazineIds && findDuplicatedNumbers(magazineIds).length > 0)
        || (originalPublisherIds && findDuplicatedNumbers(originalPublisherIds).length > 0)
        || (data.authors && data.authors.some((author) => hasDuplicatedStrings(author.roles)))
    );
}

function hasInvalidPublicationPeriod(data: {
    originalPublicationStartYear?: number | null;
    originalPublicationEndYear?: number | null;
}) {
    return Boolean(
        data.originalPublicationStartYear
        && data.originalPublicationEndYear
        && data.originalPublicationEndYear < data.originalPublicationStartYear
    );
}
