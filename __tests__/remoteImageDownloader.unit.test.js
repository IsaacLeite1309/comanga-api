/* global Buffer, Headers, ReadableStream */
const {
    createPinnedLookup,
    downloadRemoteImage,
    isPrivateOrReservedAddress
} = require('../src/infrastructure/media/RemoteImageDownloader');

function response({ status = 200, headers = {}, chunks = [Buffer.from('image')] } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        body: new ReadableStream({
            start(controller) {
                chunks.forEach((chunk) => controller.enqueue(chunk));
                controller.close();
            }
        })
    };
}

describe('download seguro da capa remota', () => {
    const publicLookup = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    it.each([
        '0.1.2.3',
        '127.0.0.1',
        '10.0.0.1',
        '100.64.0.1',
        '169.254.1.1',
        '172.16.0.1',
        '172.31.255.255',
        '192.0.0.1',
        '192.168.1.2',
        '198.18.0.1',
        '198.19.255.255',
        '224.0.0.1',
        '::1',
        'fc00::1',
        'fd00::1',
        'fe80::1',
        'ff00::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '::ffff:invalido',
        'endereco-invalido'
    ])(
        'reconhece endereço privado ou reservado: %s',
        (address) => expect(isPrivateOrReservedAddress(address)).toBe(true)
    );

    it('não confunde o endereço público do CDN do WordPress com a faixa reservada 192.0.0.0/24', () => {
        expect(isPrivateOrReservedAddress('192.0.77.2')).toBe(false);
        expect(isPrivateOrReservedAddress('100.128.0.1')).toBe(false);
        expect(isPrivateOrReservedAddress('172.32.0.1')).toBe(false);
        expect(isPrivateOrReservedAddress('198.20.0.1')).toBe(false);
        expect(isPrivateOrReservedAddress('2606:4700:4700::1111')).toBe(false);
    });

    it('entrega o endereço fixado no formato solicitado pelo Node ao conectar', async () => {
        const pinnedLookup = createPinnedLookup('192.0.77.2', 4);

        await expect(new Promise((resolve, reject) => {
            pinnedLookup('i0.wp.com', { all: true }, (error, addresses) => {
                if (error) reject(error);
                else resolve(addresses);
            });
        })).resolves.toEqual([{ address: '192.0.77.2', family: 4 }]);

        await expect(new Promise((resolve, reject) => {
            pinnedLookup('i0.wp.com', { all: false }, (error, address, family) => {
                if (error) reject(error);
                else resolve({ address, family });
            });
        })).resolves.toEqual({ address: '192.0.77.2', family: 4 });
    });

    it('baixa somente HTTPS, valida cada redirecionamento e limita os bytes reais', async () => {
        const fetchImpl = jest
            .fn()
            .mockResolvedValueOnce(response({ status: 302, headers: { location: 'https://cdn.example/cover.jpg' } }))
            .mockResolvedValueOnce(response({
                headers: { 'content-type': 'image/jpeg' },
                chunks: [Buffer.from('1234'), Buffer.from('5678')]
            }));

        await expect(downloadRemoteImage('https://example.com/cover.jpg', {
            fetchImpl,
            lookupImpl: publicLookup,
            maxBytes: 8
        })).resolves.toMatchObject({
            bytes: Buffer.from('12345678'),
            contentType: 'image/jpeg',
            finalUrl: 'https://cdn.example/cover.jpg'
        });
        expect(publicLookup).toHaveBeenCalledTimes(2);
    });

    it('rejeita origem privada antes de realizar a requisição', async () => {
        const fetchImpl = jest.fn();
        const lookupImpl = jest.fn().mockResolvedValue([{ address: '10.0.0.2', family: 4 }]);

        await expect(downloadRemoteImage('https://internal.example/cover.jpg', {
            fetchImpl,
            lookupImpl
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID', statusCode: 400 });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejeita conteúdo acima do limite mesmo sem Content-Length confiável', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            headers: { 'content-type': 'image/png' },
            chunks: [Buffer.from('12345'), Buffer.from('67890')]
        }));

        await expect(downloadRemoteImage('https://example.com/cover.png', {
            fetchImpl,
            lookupImpl: publicLookup,
            maxBytes: 9
        })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE', statusCode: 413 });
    });

    it('rejeita protocolo inseguro e MIME que não é imagem permitida', async () => {
        await expect(downloadRemoteImage('http://example.com/cover.jpg', {
            fetchImpl: jest.fn(),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });

        await expect(downloadRemoteImage('https://example.com/file.svg', {
            fetchImpl: jest.fn().mockResolvedValue(response({ headers: { 'content-type': 'image/svg+xml' } })),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_FORMAT_NOT_ALLOWED', statusCode: 415 });
    });

    it.each([
        'https://usuario:senha@example.com/cover.jpg',
        'não-é-url',
        `https://example.com/${'a'.repeat(2048)}`
    ])('rejeita URL malformada ou com credenciais: %s', async (sourceUrl) => {
        await expect(downloadRemoteImage(sourceUrl, {
            fetchImpl: jest.fn(),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });
    });

    it('diferencia falha de DNS, resposta HTTP e falha de conexão', async () => {
        await expect(downloadRemoteImage('https://dns.example/cover.jpg', {
            fetchImpl: jest.fn(),
            lookupImpl: jest.fn().mockRejectedValue(new Error('dns failed'))
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_UNAVAILABLE' });

        await expect(downloadRemoteImage('https://http.example/cover.jpg', {
            fetchImpl: jest.fn().mockResolvedValue(response({ status: 404 })),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_UNAVAILABLE' });

        await expect(downloadRemoteImage('https://network.example/cover.jpg', {
            fetchImpl: jest.fn().mockRejectedValue(new Error('network failed')),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_UNAVAILABLE' });
    });

    it('rejeita DNS vazio ou que mistura endereço público e privado', async () => {
        await expect(downloadRemoteImage('https://empty.example/cover.jpg', {
            fetchImpl: jest.fn(),
            lookupImpl: jest.fn().mockResolvedValue([])
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });

        await expect(downloadRemoteImage('https://mixed.example/cover.jpg', {
            fetchImpl: jest.fn(),
            lookupImpl: jest.fn().mockResolvedValue([
                { address: '93.184.216.34', family: 4 },
                { address: '127.0.0.1', family: 4 }
            ])
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });
    });

    it('rejeita redirecionamento sem destino e cadeia acima do limite', async () => {
        await expect(downloadRemoteImage('https://redirect.example/cover.jpg', {
            fetchImpl: jest.fn().mockResolvedValue(response({ status: 302 })),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });

        await expect(downloadRemoteImage('https://redirect.example/cover.jpg', {
            fetchImpl: jest.fn().mockResolvedValue(response({
                status: 302,
                headers: { location: '/next.jpg' }
            })),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_URL_INVALID' });
    });

    it('valida corpo ausente, vazio e Content-Length antes de processar', async () => {
        const noBody = response({ headers: { 'content-type': 'image/jpeg' } });
        noBody.body = null;
        await expect(downloadRemoteImage('https://example.com/no-body.jpg', {
            fetchImpl: jest.fn().mockResolvedValue(noBody),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_UNAVAILABLE' });

        await expect(downloadRemoteImage('https://example.com/empty.jpg', {
            fetchImpl: jest.fn().mockResolvedValue(response({
                headers: { 'content-type': 'image/jpeg' },
                chunks: []
            })),
            lookupImpl: publicLookup
        })).rejects.toMatchObject({ code: 'MEDIA_SOURCE_UNAVAILABLE' });

        await expect(downloadRemoteImage('https://example.com/declared.jpg', {
            fetchImpl: jest.fn().mockResolvedValue(response({
                headers: { 'content-type': 'image/jpeg', 'content-length': '100' }
            })),
            lookupImpl: publicLookup,
            maxBytes: 10
        })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    });
});
