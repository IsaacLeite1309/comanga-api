const sendMail = jest.fn();
const createTransport = jest.fn(() => ({ sendMail }));
const resolve4 = jest.fn();
const setDefaultResultOrder = jest.fn();

jest.mock('node:dns', () => ({
    promises: {
        resolve4
    },
    setDefaultResultOrder
}));

jest.mock('nodemailer', () => ({
    createTransport
}));

const mailer = require('../src/utils/mailer');

describe('mailer unitario', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        resolve4.mockResolvedValue(['142.250.0.109']);
        process.env = {
            ...originalEnv,
            SMTP_HOST: 'smtp.test.local',
            SMTP_PORT: '2525',
            SMTP_USER: 'usuario',
            SMTP_PASS: 'senha',
            SMTP_SECURE: 'false',
            SMTP_FROM: '"Equipe CoManga" <noreply@teste.local>',
            FRONTEND_URL: 'https://comanga-web.vercel.app/'
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('gera a mensagem de ativacao com o Nodemailer real sem enviar pela rede', async () => {
        const nodemailer = jest.requireActual('nodemailer');
        const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
        sendMail.mockImplementationOnce((options) => transport.sendMail(options));

        await mailer.sendActivationEmail('destino@teste.local', 'leitor', 'token-compat');
        const result = await sendMail.mock.results[0].value;

        expect(result.envelope.to).toEqual(['destino@teste.local']);
        expect(result.message.toString()).toContain('/activate/token-compat');
    });

    it('envia e-mail de ativacao com link do frontend configurado', async () => {
        sendMail.mockResolvedValue({});

        await mailer.sendActivationEmail('destino@teste.local', 'isaac', 'token-123');

        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
            host: '142.250.0.109',
            port: 2525,
            secure: false,
            requireTLS: true,
            family: 4,
            tls: { servername: 'smtp.test.local' },
            auth: { user: 'usuario', pass: 'senha' }
        }));
        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
            from: '"Equipe CoManga" <noreply@teste.local>',
            to: 'destino@teste.local',
            html: expect.stringContaining('https://comanga-web.vercel.app/activate/token-123')
        }));
    });

    it('usa CORS_ORIGIN como fallback de URL do frontend', async () => {
        delete process.env.FRONTEND_URL;
        process.env.CORS_ORIGIN = 'https://front-a.vercel.app,https://front-b.vercel.app';
        sendMail.mockResolvedValue({});

        await mailer.sendActivationEmail('destino@teste.local', 'isaac', 'token-abc');

        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
            html: expect.stringContaining('https://front-a.vercel.app/activate/token-abc')
        }));
    });

    it('usa porta padrao, remetente padrao e localhost quando variaveis opcionais nao existem', async () => {
        delete process.env.SMTP_PORT;
        delete process.env.SMTP_FROM;
        delete process.env.FRONTEND_URL;
        delete process.env.CORS_ORIGIN;
        sendMail.mockResolvedValue({});

        await mailer.sendActivationEmail('destino@teste.local', 'isaac', 'token-local');

        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
            port: 587
        }));
        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
            from: '"Equipe CoMangá" <noreply@comanga.com>',
            html: expect.stringContaining('http://localhost:8080/activate/token-local')
        }));
    });

    it('marca transporte como seguro quando SMTP_SECURE=true', async () => {
        process.env.SMTP_SECURE = 'true';
        sendMail.mockResolvedValue({});

        await mailer.sendActivationEmail('destino@teste.local', 'isaac', 'token-seguro');

        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
            secure: true,
            requireTLS: false
        }));
    });

    it('usa host original quando resolucao IPv4 falha', async () => {
        resolve4.mockRejectedValueOnce(new Error('DNS indisponivel'));
        sendMail.mockResolvedValue({});

        await mailer.sendActivationEmail('destino@teste.local', 'isaac', 'token-dns');

        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
            host: 'smtp.test.local',
            tls: { servername: 'smtp.test.local' }
        }));
    });

    it('falha explicitamente quando SMTP nao esta configurado', async () => {
        delete process.env.SMTP_HOST;

        await expect(mailer.sendActivationEmail('destino@teste.local', 'isaac', 'token'))
            .rejects.toMatchObject({ code: 'SMTP_NOT_CONFIGURED' });
        expect(sendMail).not.toHaveBeenCalled();
    });
});
