const mockMediaAsset = {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn()
};
const mockDeleteObjects = jest.fn();
const mockLogger = { error: jest.fn() };

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: { mediaAsset: mockMediaAsset, $transaction: callback => callback({ mediaAsset: mockMediaAsset, $queryRaw: jest.fn().mockResolvedValue([]) }) }
}));
jest.mock('../src/infrastructure/container', () => ({
    getMediaStorage: () => ({ deleteObjects: mockDeleteObjects })
}));
jest.mock('../src/infrastructure/logging/structuredLogger', () => ({
    __esModule: true,
    default: mockLogger
}));

const {
    cleanupDiscardedCoverAssets,
    activateCoverAsset,
    deleteOrphanedCoverAsset,
    isCoverAssetAttachable
} = require('../src/modules/media/coverAssetLifecycle');

describe('ciclo de vida da capa vinculada', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDeleteObjects.mockResolvedValue(undefined);
        mockMediaAsset.deleteMany.mockResolvedValue(undefined);
    });

    it('aceita ativo pendente ou atual sem vínculo e recusa registro ausente ou descartado', async () => {
        mockMediaAsset.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'discarded', status: 'Descartado' })
            .mockResolvedValueOnce({ id: 'current', status: 'Ativo', work: { id: 1 } })
            .mockResolvedValueOnce({ id: 'orphan', status: 'Pendente', work: null, volume: null });

        await expect(isCoverAssetAttachable('missing')).resolves.toBe(false);
        await expect(isCoverAssetAttachable('discarded')).resolves.toBe(false);
        await expect(isCoverAssetAttachable('current', 'current')).resolves.toBe(true);
        await expect(isCoverAssetAttachable('orphan')).resolves.toBe(true);
    });

    it.each([
        { work: { id: 1 }, volume: null },
        { work: null, volume: { id: 1 } }
    ])('recusa ativo já associado a outro cadastro: %o', async (relations) => {
        mockMediaAsset.findUnique.mockResolvedValue({
            id: 'attached',
            status: 'Ativo',
            ...relations
        });

        await expect(isCoverAssetAttachable('attached', 'other')).resolves.toBe(false);
    });

    it('processa descarte no comando separado e mantém falhas disponíveis para retry', async () => {
        mockMediaAsset.findMany.mockResolvedValueOnce([{ id: 'failed' }, { id: 'ok' }]);
        mockMediaAsset.findFirst.mockResolvedValue({ objectKey: 'key', variants: [], work: null, volume: null });
        mockDeleteObjects.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
        await cleanupDiscardedCoverAssets();
        expect(mockDeleteObjects).toHaveBeenCalledTimes(2);
        expect(mockMediaAsset.deleteMany).toHaveBeenCalledTimes(1);
        expect(mockMediaAsset.deleteMany).toHaveBeenCalledWith({ where: { id: 'ok', status: 'Descartando' } });
    });

    it('não consulta mais a Edição para decidir se a capa está vinculada', async () => {
        mockMediaAsset.findUnique.mockResolvedValue({ id: 'orphan', status: 'Pendente', work: null, volume: null });

        await isCoverAssetAttachable('orphan');

        const select = mockMediaAsset.findUnique.mock.calls[0][0].select;
        expect(select).not.toHaveProperty('edition');
        expect(select).toHaveProperty('work');
        expect(select).toHaveProperty('volume');
    });

    it('consulta a capa pelo cliente transacional fornecido, sem outra conexão', async () => {
        mockMediaAsset.findUnique.mockResolvedValue(null);
        const tx = { mediaAsset: { findUnique: jest.fn().mockResolvedValue({
            id: 'current', status: 'Ativo', work: null, volume: { id: 1 }
        }) } };
        await expect(isCoverAssetAttachable('current', 'current', tx)).resolves.toBe(true);
        expect(mockMediaAsset.findUnique).not.toHaveBeenCalled();
    });

    it('ativa a capa na mesma transação do cadastro', async () => {
        const tx = { mediaAsset: { update: jest.fn().mockResolvedValue({ id: 'asset-id' }) } };

        await expect(activateCoverAsset(tx, 'asset-id')).resolves.toEqual({ id: 'asset-id' });
        expect(tx.mediaAsset.update).toHaveBeenCalledWith({
            where: { id: 'asset-id' },
            data: { status: 'Ativo', ativadoEm: expect.any(Date) }
        });
    });

    it('preserva a operação Prisma sem antecipá-la ao compor uma transação em lote', () => {
        const operation = { then: jest.fn() };
        const client = { mediaAsset: { update: jest.fn().mockReturnValue(operation) } };

        expect(activateCoverAsset(client, 'asset-id')).toBe(operation);
        expect(operation.then).not.toHaveBeenCalled();
    });

    it('ignora ausência e ativos vinculados ao limpar órfãos', async () => {
        await deleteOrphanedCoverAsset(null);
        expect(mockMediaAsset.findFirst).not.toHaveBeenCalled();

        mockMediaAsset.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ objectKey: 'master', variants: [], work: null, volume: { id: 1 } });
        await deleteOrphanedCoverAsset('missing');
        await deleteOrphanedCoverAsset('attached');

        expect(mockDeleteObjects).not.toHaveBeenCalled();
        expect(mockMediaAsset.deleteMany).not.toHaveBeenCalled();
    });

    it('remove do provedor e do banco somente a capa órfã', async () => {
        mockMediaAsset.findFirst.mockResolvedValue({
            objectKey: 'covers/id/master.webp',
            variants: [
                { objectKey: 'covers/id/small.webp' },
                { objectKey: 'covers/id/large.webp' }
            ],
            work: null,
            volume: null
        });

        await deleteOrphanedCoverAsset('asset-id');

        expect(mockDeleteObjects).toHaveBeenCalledWith([
            'covers/id/master.webp',
            'covers/id/small.webp',
            'covers/id/large.webp'
        ]);
        expect(mockMediaAsset.deleteMany).toHaveBeenCalledWith({ where: { id: 'asset-id', status: 'Descartando' } });
    });

    it('registra falha de limpeza sem interromper o fluxo principal', async () => {
        const error = new Error('provider unavailable');
        mockMediaAsset.findFirst.mockResolvedValue({
            objectKey: 'covers/id/master.webp',
            variants: [],
            work: null,
            volume: null
        });
        mockDeleteObjects.mockRejectedValue(error);

        await expect(deleteOrphanedCoverAsset('asset-id')).resolves.toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalledWith(
            'media.orphan_cleanup_failed',
            { assetId: 'asset-id' },
            error
        );
        expect(mockMediaAsset.deleteMany).not.toHaveBeenCalled();
    });
});
