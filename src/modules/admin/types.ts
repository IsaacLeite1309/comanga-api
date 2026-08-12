interface PrismaKnownError {
    code?: string;
}

interface OptionSummary {
    id: number | string;
    label: string;
}

interface WorkSummaryInput {
    id: number;
    slug: string;
    title: string;
    originalTitle: string | null;
    visibility: string;
    adultContent: boolean;
    coverUrl: string | null;
    editionsCount?: number;
    type: OptionSummary;
    country: string;
    authors?: Array<{
        author: OptionSummary;
        roles?: Array<{
            role: string;
        }>;
    }>;
    _count?: {
        editions?: number;
    };
}

interface WorkDetailInput extends WorkSummaryInput {
    originalPublicationStartYear: number | null;
    originalPublicationEndYear: number | null;
    originalVolumeCount: number | null;
    directRelease: boolean;
    originalPublishers?: Array<{
        position: number;
        publisher: OptionSummary;
    }>;
    originalPublicationStatus: string | null;
    authors?: Array<{
        author: OptionSummary;
        roles?: Array<{
            role: string;
        }>;
    }>;
    genres?: Array<{
        genre: OptionSummary;
    }>;
    demographics?: Array<{
        demography: string;
    }>;
    serializationMagazines?: Array<{
        position: number;
        magazine: OptionSummary;
    }>;
}

interface EditionInput {
    id: number;
    workId: number;
    chronologicalNumber: number;
    coverUrl: string | null;
    visibility: string;
    brazilianPublisher: OptionSummary;
    editionType: OptionSummary;
    coverType: OptionSummary;
    format: OptionSummary;
    brazilPublicationStatus: string;
    _count?: {
        volumes?: number;
    };
}

interface VolumeInput {
    id: number;
    editionId: number;
    number: number;
    coverUrl: string | null;
    singleVolume: boolean;
    pages: number | null;
    price: unknown;
    priceCurrency: string;
    releaseDatePrecision: string;
    releaseYear: number | null;
    releaseMonth: number | null;
    releaseDay: number | null;
    isbn10: string | null;
    isbn13: string | null;
    affiliateLink: string | null;
    synopsis: string | null;
    visibility: string;
}

export type {
    PrismaKnownError,
    OptionSummary,
    WorkSummaryInput,
    WorkDetailInput,
    EditionInput,
    VolumeInput
};
