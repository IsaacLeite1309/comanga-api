/* global Buffer */
const {
    R2MediaStorage,
    r2ConfigFromEnvironment
} = require('../src/infrastructure/media/R2MediaStorage');

describe('R2MediaStorage', () => {
    const config = {
        accountId: 'account',
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        bucket: 'comanga-dev'
    };

    it('envia objeto com metadados de cache e remove lotes de chaves', async () => {
        const client = { send: jest.fn().mockResolvedValue({}) };
        const storage = new R2MediaStorage(config, client);

        await storage.putObject({
            key: 'covers/id/large.webp',
            body: Buffer.from('cover'),
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable'
        });
        await storage.deleteObjects(['covers/id/master.webp', 'covers/id/large.webp']);

        expect(storage.provider).toBe('r2');
        expect(client.send.mock.calls[0][0].input).toMatchObject({
            Bucket: 'comanga-dev',
            Key: 'covers/id/large.webp',
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable'
        });
        expect(client.send.mock.calls[1][0].input).toEqual({
            Bucket: 'comanga-dev',
            Delete: {
                Objects: [
                    { Key: 'covers/id/master.webp' },
                    { Key: 'covers/id/large.webp' }
                ],
                Quiet: true
            }
        });
    });

    it('não chama o provedor ao remover uma lista vazia', async () => {
        const client = { send: jest.fn() };
        const storage = new R2MediaStorage(config, client);

        await storage.deleteObjects([]);

        expect(client.send).not.toHaveBeenCalled();
    });

    it('trata falha parcial de exclusão como erro do provedor', async () => {
        const client = { send: jest.fn().mockResolvedValue({ Errors: [{ Key: 'covers/id/master.webp' }] }) };
        const storage = new R2MediaStorage(config, client);

        await expect(storage.deleteObjects(['covers/id/master.webp'])).rejects.toMatchObject({
            code: 'MEDIA_PROVIDER_FAILURE',
            statusCode: 502
        });
    });

    it('lê configuração sem exigir credenciais durante importação do módulo', () => {
        expect(r2ConfigFromEnvironment({
            R2_ACCOUNT_ID: 'account',
            R2_ACCESS_KEY_ID: 'access',
            R2_SECRET_ACCESS_KEY: 'secret',
            R2_BUCKET: 'bucket'
        })).toEqual({
            accountId: 'account',
            accessKeyId: 'access',
            secretAccessKey: 'secret',
            bucket: 'bucket'
        });

        expect(() => r2ConfigFromEnvironment({})).toThrow(expect.objectContaining({
            code: 'MEDIA_PROVIDER_NOT_CONFIGURED',
            statusCode: 503
        }));
    });
});
