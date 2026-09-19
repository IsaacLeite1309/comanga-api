/* global Buffer */
const { CoverImportService } = require('../src/modules/admin/media/CoverImportService');

describe('CoverImportService', () => {
    function setup(overrides = {}) {
        const processed = {
            master: { kind: 'MASTER', body: Buffer.from('master'), contentType: 'image/webp', width: 1200, height: 1800 },
            variants: [
                { kind: 'COVER_SMALL', body: Buffer.from('small'), contentType: 'image/webp', width: 320, height: 480 },
                { kind: 'COVER_LARGE', body: Buffer.from('large'), contentType: 'image/webp', width: 640, height: 960 }
            ],
            checksum: 'a'.repeat(64),
            format: 'webp'
        };
        const storage = {
            provider: 'r2',
            putObject: jest.fn().mockResolvedValue(undefined),
            deleteObjects: jest.fn().mockResolvedValue(undefined)
        };
        const repository = {
            create: jest.fn().mockResolvedValue({
                id: 'asset-id',
                objectKey: 'covers/fixed/master.webp',
                ...processed.master,
                bytes: processed.master.body.length,
                variants: [
                    { kind: 'COVER_SMALL', objectKey: 'covers/fixed/small.webp', width: 320, height: 480, bytes: 5, mimeType: 'image/webp' },
                    { kind: 'COVER_LARGE', objectKey: 'covers/fixed/large.webp', width: 640, height: 960, bytes: 5, mimeType: 'image/webp' }
                ]
            })
        };
        const dependencies = {
            storage,
            repository,
            download: jest.fn().mockResolvedValue({
                bytes: Buffer.from('source'),
                contentType: 'image/jpeg',
                finalUrl: 'https://example.com/cover.jpg'
            }),
            processImage: jest.fn().mockResolvedValue(processed),
            createId: () => 'fixed',
            resolvePublicUrl: (key) => `https://media.comanga.test/${key}`,
            ...overrides
        };
        return { service: new CoverImportService(dependencies), dependencies, storage, repository };
    }

    it('baixa, processa, armazena variantes e persiste somente chaves internas', async () => {
        const { service, storage, repository } = setup();

        await expect(service.importFromUrl({
            sourceUrl: 'https://example.com/cover.jpg',
            userId: 'user-id'
        })).resolves.toMatchObject({
            id: 'asset-id',
            coverUrl: 'https://media.comanga.test/covers/fixed/large.webp'
        });

        expect(storage.putObject).toHaveBeenCalledTimes(3);
        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'r2',
            objectKey: 'covers/fixed/master.webp',
            sourceUrl: 'https://example.com/cover.jpg',
            createdByUserId: 'user-id'
        }));
        expect(repository.create.mock.calls[0][0]).not.toHaveProperty('coverUrl');
    });

    it('compensa todos os objetos gravados quando a persistência falha', async () => {
        const repository = { create: jest.fn().mockRejectedValue(new Error('database failed')) };
        const { service, storage } = setup({ repository });

        await expect(service.importFromUrl({
            sourceUrl: 'https://example.com/cover.jpg',
            userId: 'user-id'
        })).rejects.toThrow('database failed');
        expect(storage.deleteObjects).toHaveBeenCalledWith([
            'covers/fixed/master.webp',
            'covers/fixed/small.webp',
            'covers/fixed/large.webp'
        ]);
    });

    it('limpa apenas os objetos já enviados quando o provedor falha', async () => {
        const { service, storage } = setup();
        storage.putObject
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('provider failed'));

        await expect(service.importFromUrl({
            sourceUrl: 'https://example.com/cover.jpg',
            userId: 'user-id'
        })).rejects.toThrow('provider failed');
        expect(storage.deleteObjects).toHaveBeenCalledWith(['covers/fixed/master.webp']);
    });
});
