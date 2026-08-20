import ApplicationError from '../../errors/ApplicationError';

interface MediaVariantReference {
    kind: string;
    objectKey: string;
}

interface MediaAssetReference {
    objectKey: string;
    variants?: MediaVariantReference[];
}

type MediaPublicUrlResolver = (objectKey: string) => string;

function createMediaPublicUrlResolver(publicBaseUrl: string): MediaPublicUrlResolver {
    let baseUrl: URL;
    try {
        baseUrl = new URL(publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`);
        if (baseUrl.protocol !== 'https:') throw new Error('A origem pública deve usar HTTPS.');
    } catch (error) {
        throw new ApplicationError({
            statusCode: 503,
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED',
            message: 'A origem pública de mídia não está configurada.',
            cause: error
        });
    }

    return (objectKey: string) => {
        if (!objectKey || objectKey.includes('\\') || objectKey.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(objectKey)) {
            throw new ApplicationError({
                statusCode: 500,
                code: 'MEDIA_OBJECT_KEY_INVALID',
                message: 'A referência interna de mídia é inválida.'
            });
        }

        const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
        return new URL(encodedKey, baseUrl).toString();
    };
}

function resolveCoverUrl(asset: MediaAssetReference | null | undefined, resolve: MediaPublicUrlResolver): string | null {
    if (!asset) return null;
    const preferred = asset.variants?.find((variant) => variant.kind === 'COVER_LARGE')
        || asset.variants?.find((variant) => variant.kind === 'COVER_SMALL');
    return resolve(preferred?.objectKey || asset.objectKey);
}

function mediaPublicUrlResolverFromEnvironment(environment = process.env): MediaPublicUrlResolver {
    return createMediaPublicUrlResolver(environment.MEDIA_PUBLIC_BASE_URL || '');
}

export {
    createMediaPublicUrlResolver,
    mediaPublicUrlResolverFromEnvironment,
    resolveCoverUrl
};
export type { MediaAssetReference, MediaPublicUrlResolver, MediaVariantReference };
