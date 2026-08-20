const mockMediaAsset = {
    findUnique: jest.fn(),
    delete: jest.fn()
};
const mockDeleteObjects = jest.fn();
const mockLogger = { error: jest.fn() };

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: { mediaAsset: mockMediaAsset }
}));
jest.mock('../src/infrastructure/container', () => ({
    getMediaStorage: () => ({ deleteObjects: mockDeleteObjects })
}));
jest.mock('../src/infrastructure/logging/structuredLogger', () => ({
    __esModule: true,
    default: mockLogger
}));

const {
    activateCoverAsset,
    deleteOrphanedCoverAsset,
    isCoverAssetAttachable
} = require('../src/modules/admin/media/coverAssetLifecycle');

describe('ciclo de vida da capa vinculada', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDeleteObjects.mockResolvedValue(undefined);
        mockMediaAsset.delete.mockResolvedValue(undefined);
    });

    it('aceita ativo pendente ou atual sem vínculo e recusa registro ausente ou descartado', async () => {
        mockMediaAsset.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'discarded', status: 'Descartado' })
            .mockResolvedValueOnce({ id: 'current', status: 'Ativo', work: { id: 1 } })
            .mockResolvedValueOnce({ id: 'orphan', status: 'Pendente', work: null, edition: null, volume: null });

        await expect(isCoverAssetAttachable('missing')).resolves.toBe(false);
        await expect(isCoverAssetAttachable('discarded')).resolves.toBe(false);
        await expect(isCoverAssetAttachable('current', 'current')).resolves.toBe(true);
        await expect(isCoverAssetAttachable('orphan')).resolves.toBe(true);
    });

    it.each([
        { work: { id: 1 }, edition: null, volume: null },
        { work: null, edition: { id: 1 }, volume: null },
        { work: null, edition: null, volume: { id: 1 } }
    ])('recusa ativo já associado a outro cadastro: %o', async (relations) => {
        mockMediaAsset.findUnique.mockResolvedValue({
            id: 'attached',
            status: 'Ativo',
            ...relations
        });

        await expect(isCoverAssetAttachable('attached', 'other')).resolves.toBe(false);
    });

    it('ativa a capa na mesma transação do cadastro', async () => {
        const tx = { mediaAsset: { update: jest.fn().mockResolvedValue({ id: 'asset-id' }) } };

        await expect(activateCoverAsset(tx, 'asset-id')).resolves.toEqual({ id: 'asset-id' });
        expect(tx.mediaAsset.update).toHaveBeenCalledWith({
            where: { id: 'asset-id' },
            data: { status: 'Ativo', ativadoEm: expect.any(Date) }
        });
    });

    it('ignora ausência e ativos vinculados ao limpar órfãos', async () => {
        await deleteOrphanedCoverAsset(null);
        expect(mockMediaAsset.findUnique).not.toHaveBeenCalled();

        mockMediaAsset.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ objectKey: 'master', variants: [], work: null, edition: { id: 1 }, volume: null });
        await deleteOrphanedCoverAsset('missing');
        await deleteOrphanedCoverAsset('attached');

        expect(mockDeleteObjects).not.toHaveBeenCalled();
        expect(mockMediaAsset.delete).not.toHaveBeenCalled();
    });

    it('remove do provedor e do banco somente a capa órfã', async () => {
        mockMediaAsset.findUnique.mockResolvedValue({
            objectKey: 'covers/id/master.webp',
            variants: [
                { objectKey: 'covers/id/small.webp' },
                { objectKey: 'covers/id/large.webp' }
            ],
            work: null,
            edition: null,
            volume: null
        });

        await deleteOrphanedCoverAsset('asset-id');

        expect(mockDeleteObjects).toHaveBeenCalledWith([
            'covers/id/master.webp',
            'covers/id/small.webp',
            'covers/id/large.webp'
        ]);
        expect(mockMediaAsset.delete).toHaveBeenCalledWith({ where: { id: 'asset-id' } });
    });

    it('registra falha de limpeza sem interromper o fluxo principal', async () => {
        const error = new Error('provider unavailable');
        mockMediaAsset.findUnique.mockResolvedValue({
            objectKey: 'covers/id/master.webp',
            variants: [],
            work: null,
            edition: null,
            volume: null
        });
        mockDeleteObjects.mockRejectedValue(error);

        await expect(deleteOrphanedCoverAsset('asset-id')).resolves.toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalledWith(
            'media.orphan_cleanup_failed',
            { assetId: 'asset-id' },
            error
        );
        expect(mockMediaAsset.delete).not.toHaveBeenCalled();
    });
});
