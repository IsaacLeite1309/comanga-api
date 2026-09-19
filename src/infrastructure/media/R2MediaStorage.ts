import {
    DeleteObjectsCommand,
    PutObjectCommand,
    S3Client
} from '@aws-sdk/client-s3';
import ApplicationError from '../../errors/ApplicationError';
import type MediaStorage from '../contracts/MediaStorage';
import type { PutMediaObjectInput } from '../contracts/MediaStorage';

interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
}

interface S3ClientLike {
    send(command: unknown): Promise<unknown>;
}

function providerError(cause: unknown) {
    return new ApplicationError({
        statusCode: 502,
        code: 'MEDIA_PROVIDER_FAILURE',
        message: 'Não foi possível armazenar a capa.',
        cause
    });
}

class R2MediaStorage implements MediaStorage {
    readonly provider = 'r2';
    private readonly client: S3ClientLike;

    constructor(private readonly config: R2Config, client?: S3ClientLike) {
        this.client = client || new S3Client({
            region: 'auto',
            endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            }
        });
    }

    async putObject(input: PutMediaObjectInput): Promise<void> {
        try {
            await this.client.send(new PutObjectCommand({
                Bucket: this.config.bucket,
                Key: input.key,
                Body: input.body,
                ContentType: input.contentType,
                CacheControl: input.cacheControl
            }));
        } catch (error) {
            throw providerError(error);
        }
    }

    async deleteObjects(keys: string[]): Promise<void> {
        if (keys.length === 0) return;

        try {
            const result = await this.client.send(new DeleteObjectsCommand({
                Bucket: this.config.bucket,
                Delete: {
                    Objects: keys.map((Key) => ({ Key })),
                    Quiet: true
                }
            })) as { Errors?: unknown[] };
            if (result.Errors?.length) throw new Error('O provedor não removeu todos os objetos.');
        } catch (error) {
            throw providerError(error);
        }
    }
}

function r2ConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): R2Config {
    const accountId = environment.R2_ACCOUNT_ID;
    const accessKeyId = environment.R2_ACCESS_KEY_ID;
    const secretAccessKey = environment.R2_SECRET_ACCESS_KEY;
    const bucket = environment.R2_BUCKET;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new ApplicationError({
            statusCode: 503,
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED',
            message: 'O armazenamento interno de mídia não está configurado.'
        });
    }

    return { accountId, accessKeyId, secretAccessKey, bucket };
}

export {
    R2MediaStorage,
    r2ConfigFromEnvironment
};
export type { R2Config, S3ClientLike };
