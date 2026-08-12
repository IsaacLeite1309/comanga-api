interface MediaAsset {
    provider: string;
    publicId: string | null;
    secureUrl: string;
    optimizedUrl?: string;
    width?: number;
    height?: number;
    bytes?: number;
    format?: string;
    version?: number;
}

interface ImportMediaInput {
    sourceUrl: string;
}

interface ReplaceMediaInput extends ImportMediaInput {
    publicId: string;
}

interface DeleteMediaResult {
    result: string;
}

interface MediaStorage {
    importFromUrl(input: ImportMediaInput): Promise<MediaAsset>;
    replaceFromUrl(input: ReplaceMediaInput): Promise<MediaAsset>;
    delete(publicId: string): Promise<DeleteMediaResult>;
}

export type {
    DeleteMediaResult,
    ImportMediaInput,
    MediaAsset,
    ReplaceMediaInput
};

export default MediaStorage;
