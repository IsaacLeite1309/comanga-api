const mockMediaAsset = {
    create: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn()
};

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: { mediaAsset: mockMediaAsset }
}));

const { PrismaMediaAssetRepository } = require('../src/modules/admin/media/PrismaMediaAssetRepository');

describe('PrismaMediaAssetRepository', () => {
    const repository = new PrismaMediaAssetRepository();

    beforeEach(() => jest.clearAllMocks());

    it('persiste o ativo e suas variantes sem URL pública derivada', async () => {
        const persisted = { id: 'asset-id', variants: [] };
        mockMediaAsset.create.mockResolvedValue(persisted);
        const input = {
            provider: 'r2',
            objectKey: 'covers/id/master.webp',
            sourceUrl: 'https://source.test/cover.jpg',
            mimeType: 'image/webp',
            format: 'webp',
            width: 1200,
            height: 1800,
            bytes: 100,
            checksum: 'a'.repeat(64),
            createdByUserId: 'user-id',
            variants: [{
                kind: 'COVER_LARGE',
                objectKey: 'covers/id/large.webp',
                mimeType: 'image/webp',
                width: 640,
                height: 960,
                bytes: 50
            }]
        };

        await expect(repository.create(input)).resolves.toBe(persisted);
        expect(mockMediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                provider: 'r2',
                objectKey: 'covers/id/master.webp',
                variants: { createMany: { data: input.variants } }
            })
        }));
    });

    it('retorna null quando a capa pendente não pertence ao usuário', async () => {
        mockMediaAsset.findFirst.mockResolvedValue(null);

        await expect(repository.findRemovable('asset-id', 'user-id')).resolves.toBeNull();
        expect(mockMediaAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 'asset-id',
                createdByUserId: 'user-id',
                status: 'Pendente'
            }
        }));
    });

    it.each([
        { relations: { work: null, edition: null, volume: null }, attached: false },
        { relations: { work: { id: 1 }, edition: null, volume: null }, attached: true },
        { relations: { work: null, edition: { id: 2 }, volume: null }, attached: true },
        { relations: { work: null, edition: null, volume: { id: 3 } }, attached: true }
    ])('identifica se a capa removível já está vinculada: %o', async ({ relations, attached }) => {
        mockMediaAsset.findFirst.mockResolvedValue({
            id: 'asset-id',
            objectKey: 'covers/id/master.webp',
            variants: [{ objectKey: 'covers/id/large.webp' }],
            ...relations
        });

        await expect(repository.findRemovable('asset-id', 'user-id')).resolves.toEqual({
            id: 'asset-id',
            objectKey: 'covers/id/master.webp',
            variants: [{ objectKey: 'covers/id/large.webp' }],
            attached
        });
    });

    it('exclui o ativo pela chave primária', async () => {
        mockMediaAsset.delete.mockResolvedValue({ id: 'asset-id' });

        await expect(repository.delete('asset-id')).resolves.toBeUndefined();
        expect(mockMediaAsset.delete).toHaveBeenCalledWith({ where: { id: 'asset-id' } });
    });
});
