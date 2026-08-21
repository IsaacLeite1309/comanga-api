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
    coverAsset: PublicCoverAssetInput | null;
    country: string;
    type: PublicOptionInput;
    authors: PublicAuthorRelationInput[];
}

interface PublicEditionInput {
    id: number;
    chronologicalNumber: number;
    coverAsset: PublicCoverAssetInput | null;
    work: Pick<PublicWorkInput, 'id' | 'slug' | 'title' | 'originalTitle' | 'authors'>;
    brazilianPublisher: PublicOptionInput;
    format: PublicOptionInput;
    coverType: PublicOptionInput;
    _count: {
        volumes: number;
    };
}

interface PublicEditionDetailInput {
    id: number;
    chronologicalNumber: number;
    brazilPublicationStatus: string;
    coverAsset: PublicCoverAssetInput | null;
    brazilianPublisher: PublicOptionInput;
    editionType: PublicOptionInput;
    format: PublicOptionInput;
    coverType: PublicOptionInput;
    volumes: PublicVolumePreviewInput[];
    _count: { volumes: number };
}

interface PublicEditionPageInput {
    id: number;
    chronologicalNumber: number;
    brazilPublicationStatus: string;
    coverAsset: PublicCoverAssetInput | null;
    brazilianPublisher: PublicOptionInput;
    editionType: PublicOptionInput;
    format: PublicOptionInput;
    coverType: PublicOptionInput;
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
        work: {
            id: number;
            slug: string;
            title: string;
            originalTitle: string | null;
        };
    };
}

interface PublicWorkDetailInput extends Omit<PublicWorkInput, 'authors'> {
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
    PublicWorkInput,
    PublicEditionInput,
    PublicWorkDetailInput,
    PublicEditionPageInput,
    PublicEditionVolumeInput,
    PublicVolumeDetailInput
};
