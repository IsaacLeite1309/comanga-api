import { lookup } from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import ApplicationError from '../../errors/ApplicationError';

const ALLOWED_CONTENT_TYPES = new Set([
    'image/avif',
    'image/jpeg',
    'image/png',
    'image/webp'
]);
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_SOURCE_URL_LENGTH = 2048;

type LookupLike = (
    hostname: string,
    options: { all: true; verbatim: true }
) => Promise<Array<{ address: string; family: number }>>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface DownloadOptions {
    fetchImpl?: FetchLike;
    lookupImpl?: LookupLike;
    maxBytes?: number;
    timeoutMs?: number;
}

interface DownloadedImage {
    bytes: Buffer;
    contentType: string;
    finalUrl: string;
}

function mediaError(statusCode: number, code: string, message: string, cause?: unknown) {
    return new ApplicationError({ statusCode, code, message, cause });
}

function invalidSource(cause?: unknown) {
    return mediaError(400, 'MEDIA_SOURCE_URL_INVALID', 'Informe uma URL HTTPS pública válida para a capa.', cause);
}

function parseSourceUrl(value: string, base?: URL): URL {
    try {
        const url = base ? new URL(value, base) : new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.toString().length > MAX_SOURCE_URL_LENGTH) {
            throw new Error('Origem remota inválida.');
        }
        return url;
    } catch (error) {
        throw invalidSource(error);
    }
}

function isPrivateOrReservedAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const [first, second, third] = address.split('.').map(Number);
        return first === 0
            || first === 10
            || first === 127
            || (first === 100 && second >= 64 && second <= 127)
            || (first === 169 && second === 254)
            || (first === 172 && second >= 16 && second <= 31)
            || (first === 192 && second === 0 && third === 0)
            || (first === 192 && second === 168)
            || (first === 198 && (second === 18 || second === 19))
            || first >= 224;
    }

    if (!net.isIPv6(address)) return true;
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
        const mapped = normalized.slice(7);
        if (net.isIPv4(mapped)) return isPrivateOrReservedAddress(mapped);
        const groups = mapped.split(':');
        if (groups.length === 2) {
            const high = Number.parseInt(groups[0], 16);
            const low = Number.parseInt(groups[1], 16);
            if (Number.isInteger(high) && Number.isInteger(low)) {
                return isPrivateOrReservedAddress([
                    high >> 8,
                    high & 255,
                    low >> 8,
                    low & 255
                ].join('.'));
            }
        }
        return true;
    }
    return normalized === '::'
        || normalized === '::1'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe8')
        || normalized.startsWith('fe9')
        || normalized.startsWith('fea')
        || normalized.startsWith('feb')
        || normalized.startsWith('ff');
}

async function resolvePublicHostname(url: URL, lookupImpl: LookupLike) {
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw invalidSource();

    let addresses: Awaited<ReturnType<LookupLike>>;
    try {
        addresses = await lookupImpl(hostname, { all: true, verbatim: true });
    } catch (error) {
        throw mediaError(400, 'MEDIA_SOURCE_UNAVAILABLE', 'Não foi possível localizar a origem da capa.', error);
    }

    if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
        throw invalidSource();
    }

    return addresses[0];
}

function createPinnedLookup(address: string, family: number): net.LookupFunction {
    const normalizedFamily = family as 4 | 6;

    return (_hostname, options, callback) => {
        if (options.all) {
            callback(null, [{ address, family: normalizedFamily }]);
            return;
        }

        callback(null, address, normalizedFamily);
    };
}

function fetchPinnedHttps(url: URL, address: string, family: number, init: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method: init.method,
            headers: init.headers as Record<string, string>,
            signal: init.signal || undefined,
            lookup: createPinnedLookup(address, family)
        }, (incoming) => {
            const headers = new Headers();
            Object.entries(incoming.headers).forEach(([name, value]) => {
                if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
                else if (value !== undefined) headers.set(name, value);
            });
            resolve(new Response(Readable.toWeb(incoming) as ReadableStream, {
                status: incoming.statusCode || 500,
                statusText: incoming.statusMessage,
                headers
            }));
        });
        request.once('error', reject);
        request.end();
    });
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.body) {
        throw mediaError(400, 'MEDIA_SOURCE_UNAVAILABLE', 'A origem não retornou uma imagem.');
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw mediaError(413, 'MEDIA_TOO_LARGE', 'A imagem excede o tamanho máximo permitido.');
            }
            chunks.push(chunk);
        }
    } finally {
        reader.releaseLock();
    }

    if (totalBytes === 0) throw mediaError(400, 'MEDIA_SOURCE_UNAVAILABLE', 'A origem retornou um arquivo vazio.');
    return Buffer.concat(chunks, totalBytes);
}

async function downloadRemoteImage(sourceUrl: string, options: DownloadOptions = {}): Promise<DownloadedImage> {
    const fetchImpl = options.fetchImpl;
    const lookupImpl = options.lookupImpl || (lookup as LookupLike);
    const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    let currentUrl = parseSourceUrl(sourceUrl);

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const resolvedAddress = await resolvePublicHostname(currentUrl, lookupImpl);

        let response: Response;
        try {
            const requestInit: RequestInit = {
                method: 'GET',
                redirect: 'manual',
                signal: AbortSignal.timeout(timeoutMs),
                headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' }
            };
            response = fetchImpl
                ? await fetchImpl(currentUrl, requestInit)
                : await fetchPinnedHttps(currentUrl, resolvedAddress.address, resolvedAddress.family, requestInit);
        } catch (error) {
            throw mediaError(400, 'MEDIA_SOURCE_UNAVAILABLE', 'Não foi possível baixar a imagem de origem.', error);
        }

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location || redirects === MAX_REDIRECTS) throw invalidSource();
            currentUrl = parseSourceUrl(location, currentUrl);
            continue;
        }

        if (!response.ok) {
            throw mediaError(400, 'MEDIA_SOURCE_UNAVAILABLE', 'Não foi possível baixar a imagem de origem.');
        }

        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
            throw mediaError(415, 'MEDIA_FORMAT_NOT_ALLOWED', 'A capa deve estar nos formatos JPG, PNG, WebP ou AVIF.');
        }

        const declaredLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            throw mediaError(413, 'MEDIA_TOO_LARGE', 'A imagem excede o tamanho máximo permitido.');
        }

        return {
            bytes: await readLimitedBody(response, maxBytes),
            contentType,
            finalUrl: currentUrl.toString()
        };
    }

    throw invalidSource();
}

export {
    ALLOWED_CONTENT_TYPES,
    createPinnedLookup,
    downloadRemoteImage,
    isPrivateOrReservedAddress,
    parseSourceUrl
};
export type { DownloadedImage, DownloadOptions };
