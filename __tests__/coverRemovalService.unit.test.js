const { CoverRemovalService } = require('../src/modules/admin/media/CoverRemovalService');

describe('CoverRemovalService', () => {
    it('remove objetos e registro de uma importação pendente do próprio administrador', async () => {
        const repository = {
            claimRemoval: jest.fn().mockResolvedValue({
                id: 'asset-id',
                objectKey: 'covers/id/master.webp',
                variants: [{ objectKey: 'covers/id/large.webp' }],
                attached: false
            }),
            delete: jest.fn().mockResolvedValue(undefined)
        };
        const storage = { deleteObjects: jest.fn().mockResolvedValue(undefined) };
        const service = new CoverRemovalService({ repository, storage });

        await service.removePending({ assetId: 'asset-id', userId: 'admin-id' });

        expect(repository.claimRemoval).toHaveBeenCalledWith('asset-id', 'admin-id');
        expect(storage.deleteObjects).toHaveBeenCalledWith([
            'covers/id/master.webp',
            'covers/id/large.webp'
        ]);
        expect(repository.delete).toHaveBeenCalledWith('asset-id');
    });

    it('não remove uma capa já associada', async () => {
        const repository = {
            claimRemoval: jest.fn().mockResolvedValue({
                id: 'asset-id',
                objectKey: 'covers/id/master.webp',
                variants: [],
                attached: true
            }),
            delete: jest.fn()
        };
        const storage = { deleteObjects: jest.fn() };

        await expect(new CoverRemovalService({ repository, storage }).removePending({
            assetId: 'asset-id',
            userId: 'admin-id'
        })).rejects.toMatchObject({ code: 'MEDIA_ASSET_IN_USE', statusCode: 409 });
        expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it('não revela ativo inexistente ou pertencente a outro administrador', async () => {
        const repository = { claimRemoval: jest.fn().mockResolvedValue(null), delete: jest.fn() };
        const storage = { deleteObjects: jest.fn() };

        await expect(new CoverRemovalService({ repository, storage }).removePending({
            assetId: 'asset-id',
            userId: 'admin-id'
        })).rejects.toMatchObject({ code: 'MEDIA_ASSET_NOT_FOUND', statusCode: 404 });
    });
});
