const { Buffer } = require('node:buffer');
const { Agent, request } = require('node:http');
const { performance } = require('node:perf_hooks');
const { URL } = require('node:url');
const { MAX_RESPONSE_BYTES } = require('../load-test-lib');

const agent = new Agent({ keepAlive: true });
const BODY_LIMIT = 2 * MAX_RESPONSE_BYTES;

class LoadRequestError extends Error {
    constructor(message, type, status = 0, responseBytes = 0) {
        super(message);
        this.type = type;
        this.status = status;
        this.responseBytes = responseBytes;
    }
}

function safeUrl(origin, path) {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.hostname !== '127.0.0.1' || url.protocol !== 'http:'
        || !path.startsWith('/') || path.startsWith('//') || url.username || url.password || url.hash) {
        throw new LoadRequestError('A requisição deve usar a origem HTTP local da suíte.', 'unsafe_url');
    }
    return url;
}

function parseBody(chunks, headers, status, responseBytes) {
    const text = Buffer.concat(chunks, responseBytes).toString('utf8');
    if (!headers.get('content-type')?.includes('application/json')) return text;
    try {
        return JSON.parse(text);
    } catch {
        throw new LoadRequestError('A API retornou JSON inválido.', 'invalid_json', status, responseBytes);
    }
}

function getItemCount(body) {
    if (!body || typeof body !== 'object') return undefined;
    const collection = [body.items, body.data, body.results, body.works, body.editions, body.volumes].find(Array.isArray);
    return collection?.length;
}

function readResponse(response, startedAt, resolve, reject) {
    const status = response.statusCode;
    if (status >= 300 && status < 400) {
        response.resume();
        reject(new LoadRequestError('Redirecionamento recusado pela suíte local.', 'redirect', status));
        return;
    }

    const chunks = [];
    let responseBytes = 0;
    response.on('data', (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > BODY_LIMIT) {
            response.destroy(new LoadRequestError('Resposta excedeu o limite de leitura.', 'response_too_large', status, responseBytes));
            return;
        }
        chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
        try {
            const headers = new globalThis.Headers(Object.entries(response.headersDistinct).flatMap(
                ([name, values]) => values.map((value) => [name, value])
            ));
            const body = parseBody(chunks, headers, status, responseBytes);
            resolve({ status, body, headers, responseBytes, itemCount: getItemCount(body),
                durationMs: performance.now() - startedAt });
        } catch (error) {
            reject(error);
        }
    });
}

async function sendRequest(origin, { path, method = 'GET', headers, cookie, body }, timeoutMs, signal) {
    const url = safeUrl(origin, path);
    const timeout = globalThis.AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? globalThis.AbortSignal.any([signal, timeout]) : timeout;
    const data = body === undefined ? undefined : JSON.stringify(body);
    const requestHeaders = { accept: 'application/json', ...headers };
    if (cookie) requestHeaders.cookie = cookie;
    if (data !== undefined) {
        requestHeaders['content-type'] = 'application/json';
        requestHeaders['content-length'] = Buffer.byteLength(data);
    }
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
        const client = request(url, { agent, method, headers: requestHeaders, signal: requestSignal },
            (response) => readResponse(response, startedAt, resolve, reject));
        client.on('error', reject);
        client.end(data);
    });
}

module.exports = { LoadRequestError, sendRequest };
