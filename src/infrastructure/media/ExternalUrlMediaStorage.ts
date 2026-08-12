import ApplicationError from '../../errors/ApplicationError';
import type MediaStorage from '../contracts/MediaStorage';
import type {
    DeleteMediaResult,
    ImportMediaInput,
    MediaAsset,
    ReplaceMediaInput
} from '../contracts/MediaStorage';

function validateHttpsUrl(sourceUrl: string): string {
    try {
        const parsedUrl = new URL(sourceUrl);

        if (parsedUrl.protocol !== 'https:') throw new Error('Protocolo inválido.');
        return parsedUrl.toString();
    } catch (error) {
        throw new ApplicationError({
            statusCode: 400,
            code: 'MEDIA_SOURCE_URL_INVALID',
            message: 'Informe uma URL HTTPS válida para a capa.',
            cause: error
        });
    }
}

class ExternalUrlMediaStorage implements MediaStorage {
    async importFromUrl({ sourceUrl }: ImportMediaInput): Promise<MediaAsset> {
        return {
            provider: 'external-url',
            publicId: null,
            secureUrl: validateHttpsUrl(sourceUrl)
        };
    }

    async replaceFromUrl({ sourceUrl }: ReplaceMediaInput): Promise<MediaAsset> {
        return this.importFromUrl({ sourceUrl });
    }

    async delete(_publicId: string): Promise<DeleteMediaResult> {
        return { result: 'not-managed' };
    }
}

export { ExternalUrlMediaStorage, validateHttpsUrl };
