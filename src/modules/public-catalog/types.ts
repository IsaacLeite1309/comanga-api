interface PublicOptionInput {
    id: number;
    label: string;
}

interface PublicAuthorRelationInput {
    author: PublicOptionInput;
}

interface PublicCoverAssetInput {
    objectKey: string;
    variants: Array<{
        kind: string;
        objectKey: string;
    }>;
}

interface PublicAuthorDetailRelationInput extends PublicAuthorRelationInput {
    roles: Array<{ role: string }>;
}

interface PublicVolumePreviewInput {
    id: number;
    number: number;
    singleVolume: boolean;
    releaseDatePrecision: string;
    releaseYear: number | null;
    releaseMonth: number | null;
    releaseDay: number | null;
    coverAsset: PublicCoverAssetInput | null;
}

interface PublicEditionVolumeInput extends PublicVolumePreviewInput {
    pages: number | null;
}

interface PublicWorkInput {
    id: number;
    slug: string;
    title: string;
    originalTitle: string | null;
    romanizedTitle: string;
    coverAsset: PublicCoverAssetInput | null;
    country: string;
    type: PublicOptionInput;
    authors: PublicAuthorRelationInput[];
}

// Somente o Volume 1 público desta Edição, carregado como origem da capa derivada.
interface PublicEditionCoverSourceInput {
    volumes: Array<{ coverAsset: PublicCoverAssetInput | null }>;
}

interface PublicEditionInput extends PublicEditionCoverSourceInput {
    id: number;
    chronologicalNumber: number;
    work: Pick<PublicWorkInput, 'id' | 'slug' | 'title' | 'originalTitle' | 'authors'>;
    brazilianPublisher: PublicOptionInput;
    format: PublicOptionInput | null;
    coverType: PublicOptionInput | null;
    _count: {
        volumes: number;
    };
}

interface PublicEditionDetailInput {
    id: number;
    chronologicalNumber: number;
    brazilPublicationStatus: string;
    brazilianPublisher: PublicOptionInput;
    editionType: PublicOptionInput | null;
    format: PublicOptionInput | null;
    coverType: PublicOptionInput | null;
    paper: PublicOptionInput | null;
    volumes: PublicVolumePreviewInput[];
    _count: { volumes: number };
}

interface PublicEditionPageInput extends PublicEditionCoverSourceInput {
    id: number;
    chronologicalNumber: number;
    brazilPublicationStatus: string;
    brazilianPublisher: PublicOptionInput;
    editionType: PublicOptionInput | null;
    format: PublicOptionInput | null;
    coverType: PublicOptionInput | null;
    paper: PublicOptionInput | null;
    work: {
        id: number;
        slug: string;
        title: string;
        originalTitle: string | null;
        authors: PublicAuthorRelationInput[];
    };
    _count: { volumes: number };
}

interface PublicVolumeDetailInput {
    id: number;
    number: number;
    singleVolume: boolean;
    coverAsset: PublicCoverAssetInput | null;
    pages: number | null;
    price: number | string | { toString(): string } | null;
    priceCurrency: string;
    releaseDatePrecision: string;
    releaseYear: number | null;
    releaseMonth: number | null;
    releaseDay: number | null;
    isbn10: string | null;
    isbn13: string | null;
    affiliateLink: string | null;
    synopsis: string | null;
    edition: {
        id: number;
        chronologicalNumber: number;
        brazilianPublisher: PublicOptionInput;
        work: {
            id: number;
            slug: string;
            title: string;
            originalTitle: string | null;
        };
    };
}

interface PublicWorkDetailInput extends Omit<PublicWorkInput, 'authors'> {
    synopsis: string;
    originalPublicationStartYear: number | null;
    originalPublicationEndYear: number | null;
    originalVolumeCount: number | null;
    directRelease: boolean;
    originalPublicationStatus: string;
    authors: PublicAuthorDetailRelationInput[];
    genres: Array<{ genre: PublicOptionInput }>;
    demographics: Array<{ demography: string }>;
    serializationMagazines: Array<{ magazine: PublicOptionInput }>;
    originalPublishers: Array<{ publisher: PublicOptionInput }>;
    editions: PublicEditionDetailInput[];
}

export type {
    PublicOptionInput,
    PublicCoverAssetInput,
    PublicEditionCoverSourceInput,
    PublicWorkInput,
    PublicEditionInput,
    PublicWorkDetailInput,
    PublicEditionPageInput,
    PublicEditionVolumeInput,
    PublicVolumeDetailInput
};
