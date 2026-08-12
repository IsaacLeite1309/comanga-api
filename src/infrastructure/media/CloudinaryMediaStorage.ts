import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import ApplicationError from '../../errors/ApplicationError';
import type MediaStorage from '../contracts/MediaStorage';
import type {
    DeleteMediaResult,
    ImportMediaInput,
    MediaAsset,
    ReplaceMediaInput
} from '../contracts/MediaStorage';

interface CloudinaryConfig {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    folder: string;
    maxBytes: number;
}

interface RemoteImageMetadata {
    contentType?: string;
    contentLength?: number;
    finalUrl?: string;
}

interface ProviderResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<ProviderResponse>;
type RemoteImageInspector = (sourceUrl: string, maxBytes: number) => Promise<RemoteImageMetadata>;
type LookupLike = typeof lookup;

interface CloudinaryDependencies {
    fetchImpl?: FetchLike;
    inspectRemoteImage?: RemoteImageInspector;
    now?: () => number;
}

interface CloudinaryUploadResponse {
    public_id: string;
    secure_url: string;
    width?: number;
    height?: number;
    bytes?: number;
    format?: string;
    version?: number;
}

const ALLOWED_CONTENT_TYPES = new Set([
    'image/avif',
    'image/jpeg',
    'image/png',
    'image/webp'
]);
const ALLOWED_FORMATS = new Set(['avif', 'jpeg', 'jpg', 'png', 'webp']);
const MAX_SOURCE_URL_LENGTH = 2048;
const REMOTE_INSPECTION_TIMEOUT_MS = 10_000;

function invalidSourceUrl(cause?: unknown): ApplicationError {
    return new ApplicationError({
        statusCode: 400,
        code: 'MEDIA_SOURCE_URL_INVALID',
        message: 'Informe uma URL HTTPS válida para a capa.',
        cause
    });
}

function parseHttpsUrl(sourceUrl: string): URL {
    try {
        const parsedUrl = new URL(sourceUrl);

        if (parsedUrl.protocol !== 'https:' || sourceUrl.length > MAX_SOURCE_URL_LENGTH) {
            throw new Error('A origem deve usar HTTPS e respeitar o tamanho máximo.');
        }

        return parsedUrl;
    } catch (error) {
        throw invalidSourceUrl(error);
    }
}

function isPrivateAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const parts = address.split('.').map(Number);
        return parts[0] === 10
            || parts[0] === 127
            || (parts[0] === 169 && parts[1] === 254)
            || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            || (parts[0] === 192 && parts[1] === 168)
            || parts[0] === 0;
    }

    const normalized = address.toLowerCase();
    return normalized === '::1'
        || normalized === '::'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:');
}

async function assertPublicHost(url: URL, lookupImpl: LookupLike = lookup): Promise<void> {
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw invalidSourceUrl();
    }

    const addresses = await lookupImpl(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw invalidSourceUrl();
    }
}

async function inspectRemoteImage(
    sourceUrl: string,
    maxBytes: number,
    fetchImpl: FetchLike = fetch as FetchLike,
    lookupImpl: LookupLike = lookup
): Promise<RemoteImageMetadata> {
    let currentUrl = parseHttpsUrl(sourceUrl);

    for (let redirects = 0; redirects <= 3; redirects += 1) {
        await assertPublicHost(currentUrl, lookupImpl);
        const response = await fetchImpl(currentUrl, {
            method: 'HEAD',
            redirect: 'manual',
            signal: AbortSignal.timeout(REMOTE_INSPECTION_TIMEOUT_MS)
        });

        if (response.status >= 300 && response.status < 400) {
            const location = (response as Response).headers?.get('location');
            if (!location || redirects === 3) throw invalidSourceUrl();
            currentUrl = parseHttpsUrl(new URL(location, currentUrl).toString());
            continue;
        }

        if (!response.ok) {
            throw new ApplicationError({
                statusCode: 400,
                code: 'MEDIA_SOURCE_UNAVAILABLE',
                message: 'Não foi possível acessar a imagem de origem.'
            });
        }

        const headers = (response as Response).headers;
        const contentType = headers?.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        const contentLengthHeader = headers?.get('content-length');
        const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;

        if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
            throw new ApplicationError({
                statusCode: 415,
                code: 'MEDIA_FORMAT_NOT_ALLOWED',
                message: 'A capa deve estar nos formatos JPG, PNG, WebP ou AVIF.'
            });
        }

        if (contentLength !== undefined && (!Number.isFinite(contentLength) || contentLength > maxBytes)) {
            throw new ApplicationError({
                statusCode: 413,
                code: 'MEDIA_TOO_LARGE',
                message: 'A imagem excede o tamanho máximo permitido.'
            });
        }

        return {
            contentType,
            contentLength,
            finalUrl: currentUrl.toString()
        };
    }

    throw invalidSourceUrl();
}

function buildOptimizedCoverUrl(secureUrl: string): string {
    return secureUrl.replace(
        '/image/upload/',
        '/image/upload/c_fill,ar_2:3,g_auto/f_auto,q_auto/'
    );
}

function createSignature(params: Record<string, string>, apiSecret: string): string {
    const canonicalParams = Object.entries(params)
        .filter(([, value]) => value !== '')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

    return crypto
        .createHash('sha1')
        .update(`${canonicalParams}${apiSecret}`)
        .digest('hex');
}

function asUploadResponse(payload: unknown): CloudinaryUploadResponse {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Resposta inválida do provedor.');
    }

    const candidate = payload as Partial<CloudinaryUploadResponse>;
    if (typeof candidate.public_id !== 'string' || typeof candidate.secure_url !== 'string') {
        throw new Error('Resposta incompleta do provedor.');
    }

    return candidate as CloudinaryUploadResponse;
}

function toMediaAsset(payload: CloudinaryUploadResponse): MediaAsset {
    return {
        provider: 'cloudinary',
        publicId: payload.public_id,
        secureUrl: payload.secure_url,
        optimizedUrl: buildOptimizedCoverUrl(payload.secure_url),
        width: payload.width,
        height: payload.height,
        bytes: payload.bytes,
        format: payload.format,
        version: payload.version
    };
}

class CloudinaryMediaStorage implements MediaStorage {
    private readonly fetchImpl: FetchLike;
    private readonly remoteImageInspector: RemoteImageInspector;
    private readonly now: () => number;

    constructor(
        private readonly config: CloudinaryConfig,
        dependencies: CloudinaryDependencies = {}
    ) {
        this.fetchImpl = dependencies.fetchImpl || fetch as FetchLike;
        this.remoteImageInspector = dependencies.inspectRemoteImage
            || ((sourceUrl, maxBytes) => inspectRemoteImage(sourceUrl, maxBytes, this.fetchImpl));
        this.now = dependencies.now || Date.now;
    }

    importFromUrl({ sourceUrl }: ImportMediaInput): Promise<MediaAsset> {
        return this.uploadFromUrl({ sourceUrl });
    }

    async replaceFromUrl({ sourceUrl, publicId }: ReplaceMediaInput): Promise<MediaAsset> {
        if (!publicId.trim()) throw invalidSourceUrl();
        return this.uploadFromUrl({ sourceUrl, publicId });
    }

    async delete(publicId: string): Promise<DeleteMediaResult> {
        const timestamp = String(Math.floor(this.now() / 1000));
        const signedParams = {
            invalidate: 'true',
            public_id: publicId,
            timestamp
        };
        const body = this.createSignedBody(signedParams);
        const response = await this.fetchImpl(
            `https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/destroy`,
            { method: 'POST', body }
        );
        const payload = await response.json();

        if (!response.ok || !payload || typeof payload !== 'object') {
            throw this.providerFailure(payload);
        }

        return {
            result: typeof (payload as { result?: unknown }).result === 'string'
                ? (payload as { result: string }).result
                : 'unknown'
        };
    }

    private async uploadFromUrl({
        sourceUrl,
        publicId
    }: ImportMediaInput & { publicId?: string }): Promise<MediaAsset> {
        const parsedUrl = parseHttpsUrl(sourceUrl);
        const inspected = await this.remoteImageInspector(parsedUrl.toString(), this.config.maxBytes);
        const timestamp = String(Math.floor(this.now() / 1000));
        const signedParams: Record<string, string> = publicId
            ? {
                allowed_formats: 'jpg,jpeg,png,webp,avif',
                invalidate: 'true',
                overwrite: 'true',
                public_id: publicId,
                timestamp
            }
            : {
                allowed_formats: 'jpg,jpeg,png,webp,avif',
                folder: this.config.folder,
                timestamp,
                unique_filename: 'true'
            };
        const body = this.createSignedBody(signedParams);
        body.set('file', inspected.finalUrl || parsedUrl.toString());

        const response = await this.fetchImpl(
            `https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/upload`,
            { method: 'POST', body }
        );
        const payload = await response.json();

        if (!response.ok) throw this.providerFailure(payload);

        try {
            const upload = asUploadResponse(payload);
            const format = upload.format?.toLowerCase();

            if (format && !ALLOWED_FORMATS.has(format)) {
                throw new ApplicationError({
                    statusCode: 415,
                    code: 'MEDIA_FORMAT_NOT_ALLOWED',
                    message: 'A capa deve estar nos formatos JPG, PNG, WebP ou AVIF.'
                });
            }

            if (upload.bytes !== undefined && upload.bytes > this.config.maxBytes) {
                throw new ApplicationError({
                    statusCode: 413,
                    code: 'MEDIA_TOO_LARGE',
                    message: 'A imagem excede o tamanho máximo permitido.'
                });
            }

            return toMediaAsset(upload);
        } catch (error) {
            if (error instanceof ApplicationError) throw error;
            throw this.providerFailure(error);
        }
    }

    private createSignedBody(params: Record<string, string>): FormData {
        const body = new FormData();

        Object.entries(params).forEach(([key, value]) => body.set(key, value));
        body.set('api_key', this.config.apiKey);
        body.set('signature', createSignature(params, this.config.apiSecret));
        return body;
    }

    private providerFailure(cause: unknown): ApplicationError {
        return new ApplicationError({
            statusCode: 502,
            code: 'MEDIA_PROVIDER_FAILURE',
            message: 'Não foi possível importar a capa.',
            cause
        });
    }
}

function cloudinaryConfigFromEnvironment(environment = process.env): CloudinaryConfig {
    let cloudName = environment.CLOUDINARY_CLOUD_NAME;
    let apiKey = environment.CLOUDINARY_API_KEY;
    let apiSecret = environment.CLOUDINARY_API_SECRET;

    if (environment.CLOUDINARY_URL) {
        try {
            const parsed = new URL(environment.CLOUDINARY_URL);
            cloudName ||= parsed.hostname;
            apiKey ||= decodeURIComponent(parsed.username);
            apiSecret ||= decodeURIComponent(parsed.password);
        } catch {
            cloudName = undefined;
            apiKey = undefined;
            apiSecret = undefined;
        }
    }

    if (!cloudName || !apiKey || !apiSecret) {
        throw new ApplicationError({
            statusCode: 503,
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED',
            message: 'O serviço experimental de mídia não está configurado.'
        });
    }

    const maxBytes = Number(environment.CLOUDINARY_POC_MAX_BYTES || 10 * 1024 * 1024);
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
        throw new ApplicationError({
            statusCode: 503,
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED',
            message: 'O serviço experimental de mídia não está configurado.'
        });
    }

    return {
        cloudName,
        apiKey,
        apiSecret,
        folder: environment.CLOUDINARY_POC_FOLDER || 'comanga-poc',
        maxBytes
    };
}

export {
    buildOptimizedCoverUrl,
    CloudinaryMediaStorage,
    cloudinaryConfigFromEnvironment,
    isPrivateAddress,
    inspectRemoteImage
};
