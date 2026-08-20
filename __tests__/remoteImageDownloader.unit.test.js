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
        '127.0.0.1',
        '10.0.0.1',
        '169.254.1.1',
        '192.0.0.1',
        '192.168.1.2',
        '::1',
        'fd00::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1'
    ])(
        'reconhece endereço privado ou reservado: %s',
        (address) => expect(isPrivateOrReservedAddress(address)).toBe(true)
    );

    it('não confunde o endereço público do CDN do WordPress com a faixa reservada 192.0.0.0/24', () => {
        expect(isPrivateOrReservedAddress('192.0.77.2')).toBe(false);
    });

    it('entrega o endereço fixado no formato solicitado pelo Node ao conectar', async () => {
        const pinnedLookup = createPinnedLookup('192.0.77.2', 4);

        await expect(new Promise((resolve, reject) => {
            pinnedLookup('i0.wp.com', { all: true }, (error, addresses) => {
                if (error) reject(error);
                else resolve(addresses);
            });
        })).resolves.toEqual([{ address: '192.0.77.2', family: 4 }]);
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
});
