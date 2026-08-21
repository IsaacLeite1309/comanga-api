const {
    createMediaPublicUrlResolver,
    mediaPublicUrlResolverFromEnvironment,
    resolveCoverUrl
} = require('../src/infrastructure/media/mediaPublicUrl');

describe('URL pública derivada de mídia interna', () => {
    it('combina a origem configurada com a chave codificada sem aceitar URL absoluta', () => {
        const resolve = createMediaPublicUrlResolver('https://media.comanga.test/base/');

        expect(resolve('covers/obra 1/large.webp')).toBe('https://media.comanga.test/base/covers/obra%201/large.webp');
        expect(() => resolve('https://externo.test/capa.jpg')).toThrow(expect.objectContaining({
            code: 'MEDIA_OBJECT_KEY_INVALID'
        }));
    });

    it.each([
        '',
        '/covers/id/large.webp',
        'covers\\id\\large.webp',
        'data:image/webp;base64,AAAA'
    ])('rejeita chave interna insegura: %s', (objectKey) => {
        const resolve = createMediaPublicUrlResolver('https://media.comanga.test');
        expect(() => resolve(objectKey)).toThrow(expect.objectContaining({
            code: 'MEDIA_OBJECT_KEY_INVALID'
        }));
    });

    it.each([
        '',
        'origem-inválida',
        'http://media.comanga.test'
    ])('rejeita origem pública ausente, malformada ou sem HTTPS: %s', (baseUrl) => {
        expect(() => createMediaPublicUrlResolver(baseUrl)).toThrow(expect.objectContaining({
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED'
        }));
    });

    it('prefere COVER_LARGE e retorna null quando não há ativo interno', () => {
        const resolve = createMediaPublicUrlResolver('https://media.comanga.test');
        const asset = {
            objectKey: 'covers/id/master.webp',
            variants: [
                { kind: 'COVER_SMALL', objectKey: 'covers/id/small.webp' },
                { kind: 'COVER_LARGE', objectKey: 'covers/id/large.webp' }
            ]
        };

        expect(resolveCoverUrl(asset, resolve)).toBe('https://media.comanga.test/covers/id/large.webp');
        expect(resolveCoverUrl(null, resolve)).toBeNull();
    });

    it('usa a variante pequena ou o objeto mestre quando a grande não existe', () => {
        const resolve = createMediaPublicUrlResolver('https://media.comanga.test');

        expect(resolveCoverUrl({
            objectKey: 'covers/id/master.webp',
            variants: [{ kind: 'COVER_SMALL', objectKey: 'covers/id/small.webp' }]
        }, resolve)).toBe('https://media.comanga.test/covers/id/small.webp');
        expect(resolveCoverUrl({ objectKey: 'covers/id/master.webp' }, resolve))
            .toBe('https://media.comanga.test/covers/id/master.webp');
        expect(resolveCoverUrl(undefined, resolve)).toBeNull();
    });

    it('cria o resolvedor a partir do ambiente informado', () => {
        const resolve = mediaPublicUrlResolverFromEnvironment({
            MEDIA_PUBLIC_BASE_URL: 'https://media.comanga.test'
        });

        expect(resolve('covers/id/large.webp')).toBe('https://media.comanga.test/covers/id/large.webp');
        expect(() => mediaPublicUrlResolverFromEnvironment({})).toThrow(expect.objectContaining({
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED'
        }));
    });

    it('usa o ambiente do processo quando nenhum ambiente é injetado', () => {
        const previous = process.env.MEDIA_PUBLIC_BASE_URL;
        process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.comanga.test';

        try {
            expect(mediaPublicUrlResolverFromEnvironment()('covers/id/large.webp'))
                .toBe('https://media.comanga.test/covers/id/large.webp');
        } finally {
            if (previous === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
            else process.env.MEDIA_PUBLIC_BASE_URL = previous;
        }
    });
});
