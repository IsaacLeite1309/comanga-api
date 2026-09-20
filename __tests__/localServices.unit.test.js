const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalMailService } = require('../src/infrastructure/mail/LocalMailService');
const { localDirectory } = require('../src/infrastructure/localDirectory');

it('grava links de ativação e recuperação sem enviar e-mail externo', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comanga-mail-test-'));
    const service = new LocalMailService(directory);
    try {
        await service.sendActivationEmail('demo@example.test', 'demo', 'activation');
        await service.sendPasswordResetEmail('demo@example.test', 'demo', 'recovery');
        const files = await fs.readdir(directory);
        const messages = await Promise.all(files.map(async file => JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'))));
        expect(messages.map(message => message.type).sort()).toEqual(['activate', 'redefinir-senha']);
        expect(messages.every(message => message.to === 'demo@example.test')).toBe(true);
        expect(messages.find(message => message.type === 'activate').link).toContain('/activate/activation');
        expect((await fs.stat(path.join(directory, files[0]))).mode & 0o777).toBe(0o600);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

it('exige diretório explícito e recusa uso em produção', () => {
    const old = process.env.NODE_ENV;
    try {
        expect(() => localDirectory('COMANGA_TEST_MISSING_DIR')).toThrow();
        process.env.COMANGA_TEST_MISSING_DIR = '/tmp/comanga-local';
        expect(localDirectory('COMANGA_TEST_MISSING_DIR')).toBe('/tmp/comanga-local');
        process.env.NODE_ENV = 'production';
        expect(() => localDirectory('COMANGA_TEST_MISSING_DIR')).toThrow(/produção/);
    } finally {
        process.env.NODE_ENV = old;
        delete process.env.COMANGA_TEST_MISSING_DIR;
    }
});
