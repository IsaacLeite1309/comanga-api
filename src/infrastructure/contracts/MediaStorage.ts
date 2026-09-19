interface PutMediaObjectInput {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
}

interface MediaStorage {
    readonly provider: string;
    putObject(input: PutMediaObjectInput): Promise<void>;
    deleteObjects(keys: string[]): Promise<void>;
}

export type {
    PutMediaObjectInput
};

export default MediaStorage;
