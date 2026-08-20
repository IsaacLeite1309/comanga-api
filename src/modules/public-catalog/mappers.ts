import type { PublicEditionInput, PublicOptionInput, PublicWorkInput } from './types';
import { mediaPublicUrlResolverFromEnvironment, resolveCoverUrl } from '../../infrastructure/media/mediaPublicUrl';

function mapCoverUrl(asset: PublicWorkInput['coverAsset']) {
    if (!asset) return null;
    return resolveCoverUrl(asset, mediaPublicUrlResolverFromEnvironment());
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

export {
    mapOption,
    mapPublicWork,
    mapPublicEdition
};
