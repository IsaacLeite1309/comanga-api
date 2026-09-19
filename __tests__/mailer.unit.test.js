const mailer = require('../src/utils/mailer');

describe('Resend por HTTPS', () => {
    const env = process.env;
    beforeEach(() => {
        process.env = { ...env, RESEND_API_KEY: 're_test', RESEND_FROM: 'CoMangá <email@example.com>', FRONTEND_URL: 'https://example.com/' };
        jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
    });
    afterEach(() => { process.env = env; jest.restoreAllMocks(); });
    it.each([['sendActivationEmail', 'activate'], ['sendPasswordResetEmail', 'redefinir-senha']])('envia %s sem SMTP', async (method, route) => {
        await mailer[method]('destino@example.com', '<leitor>', 'token');
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.resend.com/emails');
        expect(options.headers.Authorization).toBe('Bearer re_test');
        expect(options.signal).toBeDefined();
        const body = JSON.parse(options.body);
        expect(body.to).toEqual(['destino@example.com']);
        expect(body.html).toContain('&lt;leitor&gt;');
        expect(body.html).toContain(`https://example.com/${route}/token`);
        expect(body.text).toContain(`https://example.com/${route}/token`);
    });
    it.each(['RESEND_API_KEY', 'RESEND_FROM'])('recusa ausência de %s sem rede', async key => {
        delete process.env[key];
        await expect(mailer.sendActivationEmail('a@b.c', 'a', 't')).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
        expect(global.fetch).not.toHaveBeenCalled();
    });
    it('preserva fallback local e CORS para o link', async () => {
        delete process.env.FRONTEND_URL;
        process.env.CORS_ORIGIN = 'https://front.example.com,https://second.example.com';
        await mailer.sendActivationEmail('a@b.c', 'a', 't');
        expect(JSON.parse(global.fetch.mock.calls[0][1].body).text).toContain('https://front.example.com/activate/t');
        delete process.env.CORS_ORIGIN;
        await mailer.sendActivationEmail('a@b.c', 'a', 't');
        expect(JSON.parse(global.fetch.mock.calls[1][1].body).text).toContain('http://localhost:8080/activate/t');
    });
    it.each([false, true])('não propaga erro/resposta com segredos; falha de rede=%s', async network => {
        if (network) global.fetch.mockRejectedValue(new Error('re_secret token private@example.com'));
        else global.fetch.mockResolvedValue({ ok: false, text: async () => 're_secret' });
        await expect(mailer.sendActivationEmail('a@b.c', 'a', 't')).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', message: 'Não foi possível enviar o e-mail.' });
    });
});
