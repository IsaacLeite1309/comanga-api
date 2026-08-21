import type {
    PublicCoverAssetInput,
    PublicEditionInput,
    PublicEditionPageInput,
    PublicEditionVolumeInput,
    PublicOptionInput,
    PublicVolumeDetailInput,
    PublicWorkDetailInput,
    PublicWorkInput
} from './types';
import { mediaPublicUrlResolverFromEnvironment, resolveCoverUrl } from '../../infrastructure/media/mediaPublicUrl';

function mapCoverUrl(asset: PublicCoverAssetInput | null) {
    if (!asset) return null;
    return resolveCoverUrl(asset, mediaPublicUrlResolverFromEnvironment());
}

function mapPublicWorkDetails(work: PublicWorkDetailInput) {
    return {
        id: work.id,
        slug: work.slug,
        title: work.title,
        originalTitle: work.originalTitle,
        coverUrl: mapCoverUrl(work.coverAsset),
        type: mapOption(work.type),
        country: work.country,
        originalPublicationStartYear: work.originalPublicationStartYear,
        originalPublicationEndYear: work.originalPublicationEndYear,
        originalVolumeCount: work.originalVolumeCount,
        directRelease: work.directRelease,
        originalPublicationStatus: work.originalPublicationStatus,
        authors: work.authors.map(({ author, roles }) => ({
            ...mapOption(author),
            roles: roles.map(({ role }) => role)
        })),
        genres: work.genres.map(({ genre }) => mapOption(genre)),
        demographics: work.demographics.map(({ demography }) => demography),
        serializationMagazines: work.serializationMagazines.map(({ magazine }) => mapOption(magazine)),
        originalPublishers: work.originalPublishers.map(({ publisher }) => mapOption(publisher)),
        editions: work.editions.map((edition) => ({
            id: edition.id,
            chronologicalNumber: edition.chronologicalNumber,
            coverUrl: mapCoverUrl(edition.coverAsset),
            brazilianPublisher: mapOption(edition.brazilianPublisher),
            editionType: mapOption(edition.editionType),
            format: mapOption(edition.format),
            coverType: mapOption(edition.coverType),
            brazilPublicationStatus: edition.brazilPublicationStatus,
            volumesCount: edition._count.volumes,
            volumes: edition.volumes.map((volume) => ({
                id: volume.id,
                number: volume.number,
                singleVolume: volume.singleVolume,
                coverUrl: mapCoverUrl(volume.coverAsset),
                releaseDatePrecision: volume.releaseDatePrecision,
                releaseYear: volume.releaseYear,
                releaseMonth: volume.releaseMonth,
                releaseDay: volume.releaseDay
            }))
        }))
    };
}

function mapOption(option: PublicOptionInput) {
    return {
        id: option.id,
        label: option.label
    };
}

function mapAuthors(authors: PublicWorkInput['authors']) {
    return authors.map(({ author }) => mapOption(author));
}

function mapPublicWork(work: PublicWorkInput) {
    return {
        id: work.id,
        slug: work.slug,
        title: work.title,
        originalTitle: work.originalTitle,
        coverUrl: mapCoverUrl(work.coverAsset),
        type: mapOption(work.type),
        country: work.country,
        authors: mapAuthors(work.authors)
    };
}

function mapPublicEdition(edition: PublicEditionInput) {
    return {
        id: edition.id,
        chronologicalNumber: edition.chronologicalNumber,
        coverUrl: mapCoverUrl(edition.coverAsset),
        work: {
            id: edition.work.id,
            slug: edition.work.slug,
            title: edition.work.title,
            originalTitle: edition.work.originalTitle,
            authors: mapAuthors(edition.work.authors)
        },
        brazilianPublisher: mapOption(edition.brazilianPublisher),
        format: mapOption(edition.format),
        coverType: mapOption(edition.coverType),
        volumesCount: edition._count.volumes
    };
}

function mapPublicEditionDetails(edition: PublicEditionPageInput) {
    return {
        id: edition.id,
        chronologicalNumber: edition.chronologicalNumber,
        coverUrl: mapCoverUrl(edition.coverAsset),
        brazilianPublisher: mapOption(edition.brazilianPublisher),
        editionType: mapOption(edition.editionType),
        format: mapOption(edition.format),
        coverType: mapOption(edition.coverType),
        brazilPublicationStatus: edition.brazilPublicationStatus,
        volumesCount: edition._count.volumes,
        work: {
            id: edition.work.id,
            slug: edition.work.slug,
            title: edition.work.title,
            originalTitle: edition.work.originalTitle,
            authors: mapAuthors(edition.work.authors)
        }
    };
}

function mapPublicEditionVolume(volume: PublicEditionVolumeInput) {
    return {
        id: volume.id,
        number: volume.number,
        singleVolume: volume.singleVolume,
        coverUrl: mapCoverUrl(volume.coverAsset),
        pages: volume.pages,
        releaseDatePrecision: volume.releaseDatePrecision,
        releaseYear: volume.releaseYear,
        releaseMonth: volume.releaseMonth,
        releaseDay: volume.releaseDay
    };
}

function mapPublicVolumeDetails(volume: PublicVolumeDetailInput) {
    return {
        id: volume.id,
        number: volume.number,
        singleVolume: volume.singleVolume,
        coverUrl: mapCoverUrl(volume.coverAsset),
        pages: volume.pages,
        price: volume.price === null ? null : Number(volume.price),
        priceCurrency: volume.priceCurrency,
        releaseDatePrecision: volume.releaseDatePrecision,
        releaseYear: volume.releaseYear,
        releaseMonth: volume.releaseMonth,
        releaseDay: volume.releaseDay,
        isbn10: volume.isbn10,
        isbn13: volume.isbn13,
        affiliateLink: volume.affiliateLink,
        synopsis: volume.synopsis,
        edition: {
            id: volume.edition.id,
            chronologicalNumber: volume.edition.chronologicalNumber,
            work: {
                id: volume.edition.work.id,
                slug: volume.edition.work.slug,
                title: volume.edition.work.title,
                originalTitle: volume.edition.work.originalTitle
            }
        }
    };
}

export {
    mapOption,
    mapPublicWork,
    mapPublicEdition,
    mapPublicWorkDetails,
    mapPublicEditionDetails,
    mapPublicEditionVolume,
    mapPublicVolumeDetails
};
