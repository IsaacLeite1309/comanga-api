const { Buffer } = require('node:buffer');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalMediaStorage } = require('../src/infrastructure/media/LocalMediaStorage');

let directory;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comanga-media-test-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it('grava e remove capas somente no diretório local configurado', async () => {
    const storage = new LocalMediaStorage(directory);
    await storage.putObject({ key: 'covers/id/large.webp', body: Buffer.from('capa'),
        contentType: 'image/webp', cacheControl: 'public' });
    expect(await fs.readFile(path.join(directory, 'covers/id/large.webp'), 'utf8')).toBe('capa');
    await storage.deleteObjects(['covers/id/large.webp']);
    await expect(fs.stat(path.join(directory, 'covers/id/large.webp'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['../outside.webp', '/tmp/outside.webp', 'covers/../../outside.webp', 'covers\\outside.webp'])
('recusa caminho fora do diretório local: %s', async key => {
    const storage = new LocalMediaStorage(directory);
    await expect(storage.putObject({ key, body: Buffer.from('x') })).rejects.toThrow();
});
