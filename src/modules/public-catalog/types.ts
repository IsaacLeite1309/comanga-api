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

export type {
    PublicOptionInput,
    PublicWorkInput,
    PublicEditionInput
};
