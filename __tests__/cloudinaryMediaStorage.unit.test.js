const {
    CloudinaryMediaStorage,
    buildOptimizedCoverUrl,
    cloudinaryConfigFromEnvironment,
    inspectRemoteImage,
    isPrivateAddress
} = require('../src/infrastructure/media/CloudinaryMediaStorage');

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: jest.fn().mockResolvedValue(body)
    };
}

function headResponse({ status = 200, headers = {} } = {}) {
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
    );

    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: jest.fn((name) => normalizedHeaders[name.toLowerCase()] || null)
        },
        json: jest.fn()
    };
}

const publicLookup = jest.fn().mockResolvedValue([
    { address: '203.0.113.10', family: 4 }
]);

describe('CloudinaryMediaStorage', () => {
    const config = {
        cloudName: 'comanga-cloud',
        apiKey: 'api-key-publica',
        apiSecret: 'segredo-que-nao-pode-vazar',
        folder: 'comanga-poc',
        maxBytes: 10 * 1024 * 1024
    };

    it('importa URL HTTPS e retorna somente metadados seguros', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
            public_id: 'comanga-poc/pluto',
            secure_url: 'https://res.cloudinary.com/comanga-cloud/image/upload/v1/comanga-poc/pluto.jpg',
            width: 1000,
            height: 1500,
            bytes: 250000,
            format: 'jpg',
            version: 1
        }));
        const inspectRemoteImage = jest.fn().mockResolvedValue({
            contentType: 'image/jpeg',
            contentLength: 250000
        });
        const storage = new CloudinaryMediaStorage(config, {
            fetchImpl,
            inspectRemoteImage,
            now: () => 1700000000000
        });

        const asset = await storage.importFromUrl({
            sourceUrl: 'https://origem.test/pluto.jpg'
        });

        expect(inspectRemoteImage).toHaveBeenCalledWith(
            'https://origem.test/pluto.jpg',
            config.maxBytes
        );
        expect(asset).toEqual({
            provider: 'cloudinary',
            publicId: 'comanga-poc/pluto',
            secureUrl: 'https://res.cloudinary.com/comanga-cloud/image/upload/v1/comanga-poc/pluto.jpg',
            optimizedUrl: expect.stringContaining('c_fill,ar_2:3,g_auto/f_auto,q_auto'),
            width: 1000,
            height: 1500,
            bytes: 250000,
            format: 'jpg',
            version: 1
        });
        expect(JSON.stringify(asset)).not.toContain(config.apiSecret);

        const request = fetchImpl.mock.calls[0];
        expect(request[0]).toBe('https://api.cloudinary.com/v1_1/comanga-cloud/image/upload');
        expect(request[1].method).toBe('POST');
        expect(request[1].body.get('file')).toBe('https://origem.test/pluto.jpg');
        expect(request[1].body.get('api_key')).toBe(config.apiKey);
        expect(request[1].body.get('api_secret')).toBeNull();
        expect(request[1].body.get('signature')).toMatch(/^[a-f0-9]{40}$/);
    });

    it('substitui um ativo preservando publicId e solicitando invalidacao', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
            public_id: 'comanga-poc/pluto',
            secure_url: 'https://res.cloudinary.com/comanga-cloud/image/upload/v2/comanga-poc/pluto.jpg',
            width: 800,
            height: 1200,
            bytes: 200000,
            format: 'jpg',
            version: 2
        }));
        const storage = new CloudinaryMediaStorage(config, {
            fetchImpl,
            inspectRemoteImage: jest.fn().mockResolvedValue({ contentType: 'image/jpeg' }),
            now: () => 1700000000000
        });

        await storage.replaceFromUrl({
            sourceUrl: 'https://origem.test/pluto-nova.jpg',
            publicId: 'comanga-poc/pluto'
        });

        const body = fetchImpl.mock.calls[0][1].body;
        expect(body.get('public_id')).toBe('comanga-poc/pluto');
        expect(body.get('overwrite')).toBe('true');
        expect(body.get('invalidate')).toBe('true');
    });

    it('exclui e invalida o ativo da CDN', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ result: 'ok' }));
        const storage = new CloudinaryMediaStorage(config, {
            fetchImpl,
            inspectRemoteImage: jest.fn(),
            now: () => 1700000000000
        });

        await expect(storage.delete('comanga-poc/pluto')).resolves.toEqual({ result: 'ok' });

        expect(fetchImpl.mock.calls[0][0]).toBe(
            'https://api.cloudinary.com/v1_1/comanga-cloud/image/destroy'
        );
        const body = fetchImpl.mock.calls[0][1].body;
        expect(body.get('public_id')).toBe('comanga-poc/pluto');
        expect(body.get('invalidate')).toBe('true');
    });

    it('recusa origem insegura antes de chamar o provedor', async () => {
        const fetchImpl = jest.fn();
        const storage = new CloudinaryMediaStorage(config, {
            fetchImpl,
            inspectRemoteImage: jest.fn(),
            now: () => 1700000000000
        });

        await expect(storage.importFromUrl({
            sourceUrl: 'http://origem.test/capa.jpg'
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('traduz falha do Cloudinary para erro seguro', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
            error: { message: 'credencial secreta invalida' }
        }, false, 401));
        const storage = new CloudinaryMediaStorage(config, {
            fetchImpl,
            inspectRemoteImage: jest.fn().mockResolvedValue({ contentType: 'image/jpeg' }),
            now: () => 1700000000000
        });

        await expect(storage.importFromUrl({
            sourceUrl: 'https://origem.test/capa.jpg'
        })).rejects.toMatchObject({
            statusCode: 502,
            code: 'MEDIA_PROVIDER_FAILURE',
            message: 'Não foi possível importar a capa.'
        });
    });

    it('gera URL de entrega 2:3 com formato e qualidade automaticos', () => {
        expect(buildOptimizedCoverUrl(
            'https://res.cloudinary.com/demo/image/upload/v1/capa.jpg'
        )).toBe(
            'https://res.cloudinary.com/demo/image/upload/c_fill,ar_2:3,g_auto/f_auto,q_auto/v1/capa.jpg'
        );
    });

    it('le a configuracao sem expor credenciais ao cliente', () => {
        expect(cloudinaryConfigFromEnvironment({
            CLOUDINARY_URL: 'cloudinary://chave:segredo@comanga-cloud',
            CLOUDINARY_POC_FOLDER: 'comanga-poc',
            CLOUDINARY_POC_MAX_BYTES: '1024'
        })).toEqual({
            cloudName: 'comanga-cloud',
            apiKey: 'chave',
            apiSecret: 'segredo',
            folder: 'comanga-poc',
            maxBytes: 1024
        });
    });

    it('falha de forma segura quando o provedor nao esta configurado', () => {
        expect(() => cloudinaryConfigFromEnvironment({})).toThrow(expect.objectContaining({
            statusCode: 503,
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED'
        }));
    });

    it.each([
        ['10.0.0.1', true],
        ['127.0.0.1', true],
        ['169.254.2.3', true],
        ['172.16.0.1', true],
        ['172.31.255.254', true],
        ['192.168.1.2', true],
        ['0.0.0.0', true],
        ['198.51.100.5', false],
        ['::1', true],
        ['::', true],
        ['fc00::1', true],
        ['fd00::1', true],
        ['fe80::1', true],
        ['2001:db8::1', false]
    ])('classifica o endereco %s como privado=%s', (address, expected) => {
        expect(isPrivateAddress(address)).toBe(expected);
    });

    it('inspeciona uma imagem HTTPS e segue redirecionamento seguro', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(headResponse({
                status: 302,
                headers: { location: 'https://cdn.test/capa-final.jpg' }
            }))
            .mockResolvedValueOnce(headResponse({
                headers: {
                    'content-type': 'image/jpeg; charset=binary',
                    'content-length': '2048'
                }
            }));

        await expect(inspectRemoteImage(
            'https://origem.test/capa.jpg',
            4096,
            fetchImpl,
            publicLookup
        )).resolves.toEqual({
            contentType: 'image/jpeg',
            contentLength: 2048,
            finalUrl: 'https://cdn.test/capa-final.jpg'
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it.each([
        [headResponse({ status: 404 }), 'MEDIA_SOURCE_UNAVAILABLE'],
        [headResponse({ headers: { 'content-type': 'text/html' } }), 'MEDIA_FORMAT_NOT_ALLOWED'],
        [headResponse({ headers: { 'content-type': 'image/png', 'content-length': '5000' } }), 'MEDIA_TOO_LARGE'],
        [headResponse({ headers: { 'content-type': 'image/webp', 'content-length': 'invalido' } }), 'MEDIA_TOO_LARGE']
    ])('recusa origem remota invalida com %s', async (response, expectedCode) => {
        await expect(inspectRemoteImage(
            'https://origem.test/capa.jpg',
            4096,
            jest.fn().mockResolvedValue(response),
            publicLookup
        )).rejects.toMatchObject({ code: expectedCode });
    });

    it('recusa host local e resolucao para rede privada antes do download', async () => {
        const fetchImpl = jest.fn();

        await expect(inspectRemoteImage(
            'https://localhost/capa.jpg',
            4096,
            fetchImpl,
            publicLookup
        )).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });

        await expect(inspectRemoteImage(
            'https://origem.test/capa.jpg',
            4096,
            fetchImpl,
            jest.fn().mockResolvedValue([{ address: '192.168.0.1', family: 4 }])
        )).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('recusa redirecionamento sem destino', async () => {
        await expect(inspectRemoteImage(
            'https://origem.test/capa.jpg',
            4096,
            jest.fn().mockResolvedValue(headResponse({ status: 302 })),
            publicLookup
        )).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });
    });

    it.each([
        [{ public_id: 'capa-sem-url' }, 'MEDIA_PROVIDER_FAILURE'],
        [null, 'MEDIA_PROVIDER_FAILURE'],
        [{
            public_id: 'comanga-poc/capa',
            secure_url: 'https://res.cloudinary.com/demo/image/upload/capa.gif',
            format: 'gif'
        }, 'MEDIA_FORMAT_NOT_ALLOWED'],
        [{
            public_id: 'comanga-poc/capa',
            secure_url: 'https://res.cloudinary.com/demo/image/upload/capa.jpg',
            format: 'jpg',
            bytes: 20 * 1024 * 1024
        }, 'MEDIA_TOO_LARGE']
    ])('recusa resposta insegura do upload com %s', async (payload, expectedCode) => {
        const storage = new CloudinaryMediaStorage(config, {
            fetchImpl: jest.fn().mockResolvedValue(jsonResponse(payload)),
            inspectRemoteImage: jest.fn().mockResolvedValue({ contentType: 'image/jpeg' }),
            now: () => 1700000000000
        });

        await expect(storage.importFromUrl({
            sourceUrl: 'https://origem.test/capa.jpg'
        })).rejects.toMatchObject({ code: expectedCode });
    });

    it('recusa publicId vazio e traduz exclusao recusada pelo provedor', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ error: {} }, false, 401));
        const storage = new CloudinaryMediaStorage(config, {
            fetchImpl,
            inspectRemoteImage: jest.fn(),
            now: () => 1700000000000
        });

        await expect(storage.replaceFromUrl({
            sourceUrl: 'https://origem.test/capa.jpg',
            publicId: ' '
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });
        await expect(storage.delete('comanga-poc/capa')).rejects.toMatchObject({
            code: 'MEDIA_PROVIDER_FAILURE'
        });
    });

    it('valida valores opcionais da configuracao', () => {
        expect(() => cloudinaryConfigFromEnvironment({
            CLOUDINARY_CLOUD_NAME: 'cloud',
            CLOUDINARY_API_KEY: 'key',
            CLOUDINARY_API_SECRET: 'secret',
            CLOUDINARY_POC_MAX_BYTES: '0'
        })).toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_NOT_CONFIGURED' }));

        expect(cloudinaryConfigFromEnvironment({
            CLOUDINARY_CLOUD_NAME: 'cloud',
            CLOUDINARY_API_KEY: 'key',
            CLOUDINARY_API_SECRET: 'secret'
        })).toEqual(expect.objectContaining({
            folder: 'comanga-poc',
            maxBytes: 10 * 1024 * 1024
        }));
    });
});
