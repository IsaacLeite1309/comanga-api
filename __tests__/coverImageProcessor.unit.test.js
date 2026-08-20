/* global Buffer */
const sharp = require('sharp');
const { processCoverImage } = require('../src/infrastructure/media/CoverImageProcessor');

describe('processamento interno de capas', () => {
    it('decodifica a imagem real e gera variantes WebP 2:3 previsíveis', async () => {
        const source = await sharp({
            create: { width: 900, height: 900, channels: 3, background: '#336699' }
        }).jpeg().toBuffer();

        const result = await processCoverImage(source);

        expect(result).toMatchObject({
            format: 'webp',
            master: { kind: 'MASTER', width: 1200, height: 1800, contentType: 'image/webp' },
            variants: [
                { kind: 'COVER_SMALL', width: 320, height: 480, contentType: 'image/webp' },
                { kind: 'COVER_LARGE', width: 640, height: 960, contentType: 'image/webp' }
            ]
        });
        expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(result.master.body.length).toBeGreaterThan(0);
    });

    it('rejeita bytes que não formam uma imagem decodificável', async () => {
        await expect(processCoverImage(Buffer.from('<svg></svg>'))).rejects.toMatchObject({
            code: 'MEDIA_IMAGE_INVALID',
            statusCode: 415
        });
    });

    it('rejeita imagens acima do limite de pixels antes de gerar variantes', async () => {
        const source = await sharp({
            create: { width: 100, height: 100, channels: 3, background: '#000000' }
        }).png().toBuffer();

        await expect(processCoverImage(source, { maxPixels: 9_999 })).rejects.toMatchObject({
            code: 'MEDIA_DIMENSIONS_EXCEEDED',
            statusCode: 413
        });
    });
});
