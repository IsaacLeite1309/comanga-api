const {
    volumePayloadSchema,
    updateVolumeSchema
} = require('../src/modules/admin/schemas');

const validVolume = {
    number: 1,
    coverUrl: 'https://cdn.comanga.test/volume-1.jpg',
    releaseDatePrecision: 'Completa',
    releaseYear: 2024,
    releaseMonth: 2,
    releaseDay: 29,
    isbn10: '0-306-40615-2',
    isbn13: '978-0-306-40615-7'
};

describe('schemas administrativos de Volume', () => {
    it.each([
        'data:image/png;base64,AAAA',
        'ftp://cdn.comanga.test/volume-1.jpg',
        'file:///tmp/volume-1.jpg'
    ])('rejeita capa fora de HTTP/HTTPS: %s', (coverUrl) => {
        const result = volumePayloadSchema.safeParse({ ...validVolume, coverUrl });

        expect(result.success).toBe(false);
    });

    it.each([
        ['isbn10', '1234567890'],
        ['isbn10', '9780306406157'],
        ['isbn13', '9780306406158'],
        ['isbn13', '0306406152']
    ])('rejeita %s invalido', (field, value) => {
        const result = volumePayloadSchema.safeParse({ ...validVolume, [field]: value });

        expect(result.success).toBe(false);
    });

    it('aceita ISBN-10 e ISBN-13 validos com separadores', () => {
        expect(volumePayloadSchema.safeParse(validVolume).success).toBe(true);
    });

    it('rejeita uma data completa inexistente no calendario', () => {
        const result = volumePayloadSchema.safeParse({
            ...validVolume,
            releaseYear: 2023,
            releaseMonth: 2,
            releaseDay: 29
        });

        expect(result.success).toBe(false);
    });

    it('aplica as mesmas validacoes no patch', () => {
        expect(updateVolumeSchema.safeParse({ coverUrl: 'data:image/jpeg;base64,AAAA' }).success).toBe(false);
        expect(updateVolumeSchema.safeParse({ isbn13: '9780306406158' }).success).toBe(false);
    });
});
