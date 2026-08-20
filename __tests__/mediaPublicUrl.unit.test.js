const {
    createMediaPublicUrlResolver,
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
});
