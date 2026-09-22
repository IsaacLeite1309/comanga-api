/* global Buffer */
const errorHandler = require('../src/middlewares/errorHandler');
const { CoverImportService } = require('../src/modules/media/CoverImportService');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };
    return res;
}

function handle(error, req = {}) {
    const res = makeRes();
    errorHandler(error, req, res, jest.fn());
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('falhas de banco não vazam detalhes internos pela resposta HTTP', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
    });

    it.each([
        ['registro inexistente', 'P2025', 'An operation failed because it depends on one or more records that were required but not found.'],
        ['violação de unicidade', 'P2002', 'Unique constraint failed on the fields: (`email`)'],
        ['falha de conexão', 'P1001', "Can't reach database server at db.interno.local:5432"]
    ])('converte %s do Prisma em 500 genérico sem repetir a mensagem do driver', (_nome, code, message) => {
        const error = Object.assign(new Error(message), { code });

        const { status, body } = handle(error, { method: 'GET', originalUrl: '/api/admin/works/10' });

        expect(status).toBe(500);
        expect(body.error).toBe('Erro interno do servidor.');
        expect(body.code).toBe('INTERNAL_SERVER_ERROR');
        expect(JSON.stringify(body)).not.toContain('db.interno.local');
        expect(JSON.stringify(body)).not.toContain('Unique constraint');
    });

    it.each([['P2003'], ['P2004']])('traduz a violação de integridade %s em conflito de catálogo', (code) => {
        const { status, body } = handle(Object.assign(new Error('Foreign key constraint failed on the field: `work_id`'), { code }));

        expect(status).toBe(409);
        expect(body).toEqual({
            error: 'A alteração conflita com um registro associado ou uma regra do catálogo.',
            code: 'DATA_INTEGRITY_CONFLICT'
        });
    });

    it.each([
        ['status ausente', undefined, 500],
        ['status abaixo da faixa de erro', 200, 500],
        ['status acima da faixa HTTP', 999, 500],
        ['status de erro conhecido', 409, 409]
    ])('normaliza %s antes de responder', (_nome, statusCode, esperado) => {
        const error = Object.assign(new Error('Conflito de dados.'), statusCode ? { statusCode } : {});

        expect(handle(error).status).toBe(esperado);
    });

    it('preserva o código de negócio de uma indisponibilidade de infraestrutura sem expor a causa', () => {
        const error = Object.assign(new Error('R2 credentials rejected for bucket comanga-prod'), {
            statusCode: 503,
            code: 'MEDIA_STORAGE_UNAVAILABLE'
        });

        const { status, body } = handle(error);

        expect(status).toBe(503);
        expect(body).toEqual({ error: 'Erro interno do servidor.', code: 'MEDIA_STORAGE_UNAVAILABLE' });
    });
});

describe('atomicidade da importação de capa diante de falhas de mídia', () => {
    function setup(overrides = {}) {
        const processed = {
            master: { kind: 'MASTER', body: Buffer.from('master'), contentType: 'image/webp', width: 1200, height: 1800 },
            variants: [
                { kind: 'COVER_SMALL', body: Buffer.from('small'), contentType: 'image/webp', width: 320, height: 480 }
            ],
            checksum: 'a'.repeat(64),
            format: 'webp'
        };
        const storage = {
            provider: 'r2',
            putObject: jest.fn().mockResolvedValue(undefined),
            deleteObjects: jest.fn().mockResolvedValue(undefined)
        };
        const repository = { create: jest.fn().mockResolvedValue({ id: 'asset-id', objectKey: 'k', variants: [] }) };
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

    const importar = (service) => service.importFromUrl({
        sourceUrl: 'https://example.com/cover.jpg',
        userId: 'user-id'
    });

    it.each([
        ['tempo esgotado no download', 'MEDIA_SOURCE_UNAVAILABLE'],
        ['imagem acima do tamanho permitido', 'MEDIA_TOO_LARGE'],
        ['formato não permitido', 'MEDIA_FORMAT_NOT_ALLOWED']
    ])('não grava objeto nem registro quando o download falha por %s', async (_nome, code) => {
        const download = jest.fn().mockRejectedValue(Object.assign(new Error('falha de origem'), { code }));
        const { service, storage, repository, dependencies } = setup({ download });

        await expect(importar(service)).rejects.toMatchObject({ code });
        expect(dependencies.processImage).not.toHaveBeenCalled();
        expect(storage.putObject).not.toHaveBeenCalled();
        expect(storage.deleteObjects).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
    });

    it('não grava objeto quando o processamento recusa a imagem por excesso de pixels', async () => {
        const processImage = jest.fn().mockRejectedValue(
            Object.assign(new Error('imagem muito grande'), { code: 'MEDIA_PIXELS_EXCEEDED' })
        );
        const { service, storage, repository } = setup({ processImage });

        await expect(importar(service)).rejects.toMatchObject({ code: 'MEDIA_PIXELS_EXCEEDED' });
        expect(storage.putObject).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
    });

    it('mantém o erro original quando a própria compensação no provedor falha', async () => {
        const repository = { create: jest.fn().mockRejectedValue(new Error('database failed')) };
        const { service, storage } = setup({ repository });
        storage.deleteObjects.mockRejectedValue(new Error('provedor indisponível na limpeza'));

        // A falha da limpeza não pode substituir a causa que o administrador precisa ver.
        await expect(importar(service)).rejects.toThrow('database failed');
        expect(storage.deleteObjects).toHaveBeenCalledWith([
            'covers/fixed/master.webp',
            'covers/fixed/small.webp'
        ]);
    });
});
