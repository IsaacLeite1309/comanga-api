const { createAdminMediaHandlers } = require('../src/modules/admin/media');

function response() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        end: jest.fn(() => res)
    };
    return res;
}

describe('API administrativa de capas internas', () => {
    it('importa uma URL HTTPS usando a identidade do administrador autenticado', async () => {
        const logger = { info: jest.fn(), error: jest.fn() };
        const importService = {
            importFromUrl: jest.fn().mockResolvedValue({
                id: 'asset-id',
                coverUrl: 'https://media.comanga.test/covers/id/large.webp',
                width: 1200,
                height: 1800,
                format: 'webp',
                variants: []
            })
        };
        const handler = createAdminMediaHandlers({
            getImportService: () => importService,
            logger,
            now: jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(135)
        }).importCover;
        const req = {
            body: { sourceUrl: 'https://example.com/cover.jpg' },
            user: { userId: 'admin-id', role: 'Administrador' }
        };
        const res = response();

        await handler(req, res, jest.fn());

        expect(importService.importFromUrl).toHaveBeenCalledWith({
            sourceUrl: 'https://example.com/cover.jpg',
            userId: 'admin-id'
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ asset: expect.objectContaining({ id: 'asset-id' }) });
        expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('example.com');
        expect(logger.info).toHaveBeenCalledWith('media.cover_import.completed', expect.objectContaining({
            assetId: 'asset-id',
            durationMs: 35,
            result: 'success'
        }));
        expect(JSON.stringify(logger.info.mock.calls)).not.toContain('example.com');
    });

    it('recusa origem HTTP antes de acessar o serviço', async () => {
        const importService = { importFromUrl: jest.fn() };
        const handler = createAdminMediaHandlers({ getImportService: () => importService }).importCover;
        const res = response();

        await handler({
            body: { sourceUrl: 'http://example.com/cover.jpg' },
            user: { userId: 'admin-id', role: 'Administrador' }
        }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Informe uma URL HTTPS válida para a capa.',
            code: 'MEDIA_SOURCE_URL_INVALID'
        });
        expect(importService.importFromUrl).not.toHaveBeenCalled();
    });

    it('encaminha falhas seguras ao error handler', async () => {
        const logger = { info: jest.fn(), error: jest.fn() };
        const error = Object.assign(new Error('Formato inválido.'), {
            code: 'MEDIA_IMAGE_INVALID',
            statusCode: 415
        });
        const importService = { importFromUrl: jest.fn().mockRejectedValue(error) };
        const next = jest.fn();

        await createAdminMediaHandlers({ getImportService: () => importService, logger }).importCover({
            body: { sourceUrl: 'https://example.com/cover.jpg' },
            user: { userId: 'admin-id', role: 'Administrador' }
        }, response(), next);

        expect(next).toHaveBeenCalledWith(error);
        expect(logger.error).toHaveBeenCalledWith('media.cover_import.failed', expect.objectContaining({
            code: 'MEDIA_IMAGE_INVALID',
            result: 'failure'
        }));
    });

    it('remove capa pendente do próprio administrador e responde sem conteúdo', async () => {
        const removalService = { removePending: jest.fn().mockResolvedValue(undefined) };
        const handler = createAdminMediaHandlers({ getRemovalService: () => removalService }).deletePendingCover;
        const res = response();

        await handler({
            params: { assetId: ['123e4567-e89b-42d3-a456-426614174000'] },
            user: { userId: 'admin-id', role: 'Administrador' }
        }, res, jest.fn());

        expect(removalService.removePending).toHaveBeenCalledWith({
            assetId: '123e4567-e89b-42d3-a456-426614174000',
            userId: 'admin-id'
        });
        expect(res.status).toHaveBeenCalledWith(204);
        expect(res.end).toHaveBeenCalled();
    });

    it.each([
        { assetId: 'identificador-inválido', user: { userId: 'admin-id' } },
        { assetId: '123e4567-e89b-42d3-a456-426614174000', user: undefined }
    ])('recusa remoção sem UUID e identidade válidos: %o', async ({ assetId, user }) => {
        const removalService = { removePending: jest.fn() };
        const handler = createAdminMediaHandlers({ getRemovalService: () => removalService }).deletePendingCover;
        const res = response();

        await handler({ params: { assetId }, user }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Identificador de capa inválido.',
            code: 'MEDIA_ASSET_ID_INVALID'
        });
        expect(removalService.removePending).not.toHaveBeenCalled();
    });

    it('encaminha falha da remoção ao error handler', async () => {
        const error = new Error('asset attached');
        const removalService = { removePending: jest.fn().mockRejectedValue(error) };
        const handler = createAdminMediaHandlers({ getRemovalService: () => removalService }).deletePendingCover;
        const next = jest.fn();

        await handler({
            params: { assetId: '123e4567-e89b-42d3-a456-426614174000' },
            user: { userId: 'admin-id', role: 'Administrador' }
        }, response(), next);

        expect(next).toHaveBeenCalledWith(error);
    });
});
