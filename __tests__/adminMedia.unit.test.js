const {
    createAdminMediaHandlers,
    InMemoryMediaPocRegistry
} = require('../src/modules/admin/media');

function makeReq(body = {}) {
    return { body };
}

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        end: jest.fn(() => res)
    };
    return res;
}

describe('prova de conceito administrativa de capas', () => {
    const importedAsset = {
        provider: 'cloudinary',
        publicId: 'comanga-poc/pluto',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1/comanga-poc/pluto.jpg',
        optimizedUrl: 'https://res.cloudinary.com/demo/image/upload/t_cover/v1/comanga-poc/pluto.jpg',
        width: 1000,
        height: 1500,
        bytes: 250000,
        format: 'jpg',
        version: 1
    };

    it('importa e registra metadados apenas no escopo em memoria da POC', async () => {
        const storage = {
            importFromUrl: jest.fn().mockResolvedValue(importedAsset)
        };
        const registry = new InMemoryMediaPocRegistry();
        const handlers = createAdminMediaHandlers({
            isEnabled: () => true,
            getStorage: () => storage,
            registry
        });
        const res = makeRes();

        await handlers.importCover(makeReq({
            url: 'https://origem.test/pluto.jpg'
        }), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ asset: importedAsset });
        expect(registry.getMetrics()).toEqual({
            activeAssets: 1,
            totalBytes: 250000,
            imports: 1,
            replacements: 0,
            deletions: 0
        });
    });

    it('recusa a POC quando a flag esta desativada', async () => {
        const handlers = createAdminMediaHandlers({
            isEnabled: () => false,
            getStorage: jest.fn(),
            registry: new InMemoryMediaPocRegistry()
        });
        const res = makeRes();

        await handlers.importCover(makeReq({ url: 'https://origem.test/capa.jpg' }), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
            error: 'A prova de conceito de mídia não está habilitada.',
            code: 'MEDIA_POC_DISABLED'
        });
    });

    it('valida a entrada antes de chamar o armazenamento', async () => {
        const storage = { importFromUrl: jest.fn() };
        const handlers = createAdminMediaHandlers({
            isEnabled: () => true,
            getStorage: () => storage,
            registry: new InMemoryMediaPocRegistry()
        });
        const res = makeRes();

        await handlers.importCover(makeReq({ url: 'http://origem.test/capa.jpg' }), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(storage.importFromUrl).not.toHaveBeenCalled();
    });

    it('substitui, exclui e contabiliza invalidacoes da POC', async () => {
        const storage = {
            importFromUrl: jest.fn().mockResolvedValue(importedAsset),
            replaceFromUrl: jest.fn().mockResolvedValue({ ...importedAsset, version: 2 }),
            delete: jest.fn().mockResolvedValue({ result: 'ok' })
        };
        const registry = new InMemoryMediaPocRegistry();
        const handlers = createAdminMediaHandlers({
            isEnabled: () => true,
            getStorage: () => storage,
            registry
        });

        await handlers.importCover(makeReq({ url: 'https://origem.test/capa.jpg' }), makeRes(), jest.fn());
        await handlers.replaceCover(makeReq({
            url: 'https://origem.test/capa-nova.jpg',
            publicId: importedAsset.publicId
        }), makeRes(), jest.fn());
        const deleteRes = makeRes();
        await handlers.deleteCover(makeReq({ publicId: importedAsset.publicId }), deleteRes, jest.fn());

        expect(storage.replaceFromUrl).toHaveBeenCalled();
        expect(storage.delete).toHaveBeenCalledWith(importedAsset.publicId);
        expect(deleteRes.status).toHaveBeenCalledWith(204);
        expect(deleteRes.end).toHaveBeenCalledTimes(1);
        expect(registry.getMetrics()).toEqual({
            activeAssets: 0,
            totalBytes: 0,
            imports: 1,
            replacements: 1,
            deletions: 1
        });
    });
});
