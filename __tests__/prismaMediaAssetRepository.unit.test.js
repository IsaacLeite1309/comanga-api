const mockMediaAsset = {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn()
};

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: { mediaAsset: mockMediaAsset, $transaction: callback => callback({ mediaAsset: mockMediaAsset, $queryRaw: jest.fn().mockResolvedValue([]) }) }
}));

const { PrismaMediaAssetRepository } = require('../src/modules/media/PrismaMediaAssetRepository');

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

        await expect(repository.claimRemoval('asset-id', 'user-id')).resolves.toBeNull();
        expect(mockMediaAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 'asset-id',
                createdByUserId: 'user-id',
                status: { in: ['Pendente', 'Descartando'] }
            }
        }));
    });

    it.each([
        { relations: { work: null, volume: null }, attached: false },
        { relations: { work: { id: 1 }, volume: null }, attached: true },
        { relations: { work: null, volume: { id: 3 } }, attached: true }
    ])('identifica se a capa removível já está vinculada: %o', async ({ relations, attached }) => {
        mockMediaAsset.findFirst.mockResolvedValue({
            id: 'asset-id',
            objectKey: 'covers/id/master.webp',
            variants: [{ objectKey: 'covers/id/large.webp' }],
            ...relations
        });

        await expect(repository.claimRemoval('asset-id', 'user-id')).resolves.toEqual({
            id: 'asset-id',
            objectKey: 'covers/id/master.webp',
            variants: [{ objectKey: 'covers/id/large.webp' }],
            attached
        });
    });

    it('não considera mais a Edição ao apurar vínculo da capa removível', async () => {
        mockMediaAsset.findFirst.mockResolvedValue({
            id: 'asset-id',
            objectKey: 'covers/id/master.webp',
            variants: [],
            work: null,
            volume: null
        });

        await repository.claimRemoval('asset-id', 'user-id');

        expect(mockMediaAsset.findFirst.mock.calls[0][0].select).not.toHaveProperty('edition');
    });

    it('exclui o ativo pela chave primária', async () => {
        mockMediaAsset.deleteMany.mockResolvedValue({ id: 'asset-id' });

        await expect(repository.delete('asset-id')).resolves.toBeUndefined();
        expect(mockMediaAsset.deleteMany).toHaveBeenCalledWith({ where: { id: 'asset-id', status: 'Descartando' } });
    });
});
