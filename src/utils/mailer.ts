import dns from 'node:dns';
import nodemailer from 'nodemailer';

dns.setDefaultResultOrder('ipv4first');

interface SmtpConfigError extends Error {
    code?: string;
}

async function resolveSmtpHost(host: string): Promise<string> {
    try {
        const addresses = await dns.promises.resolve4(host);
        return addresses[0] || host;
    } catch (error) {
        console.error('Nao foi possivel resolver IPv4 do SMTP, usando host original:', error);
        return host;
    }
}

async function getRequiredSmtpConfig() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
    const secure = SMTP_SECURE === 'true';

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        const error: SmtpConfigError = new Error('Servico de e-mail nao configurado.');
        error.code = 'SMTP_NOT_CONFIGURED';
        throw error;
    }

    const smtpHost = await resolveSmtpHost(SMTP_HOST);

    return {
        host: smtpHost,
        port: Number(SMTP_PORT || 587),
        secure,
        requireTLS: !secure,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        },
        tls: {
            servername: SMTP_HOST
        },
        family: 4,
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000
    };
}

async function createTransporter() {
    return nodemailer.createTransport(await getRequiredSmtpConfig());
}

async function sendActivationEmail(toEmail: string, username: string, token: string): Promise<void> {
    const frontendUrl = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:8080')
        .split(',')[0]
        .trim()
        .replace(/\/$/, '');
    const activationLink = `${frontendUrl}/activate/${token}`;

    const mailOptions = {
        from: process.env.SMTP_FROM || '"Equipe CoMangá" <noreply@comanga.com>',
        to: toEmail,
        subject: 'CoMangá - Ative sua conta!',
        html: `
            <h2>Olá, ${username}!</h2>
            <p>Obrigado por se cadastrar no CoMangá. Para liberar seu acesso, clique no link abaixo:</p>
            <a href="${activationLink}" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Ativar minha conta</a>
            <p>Se você não solicitou este cadastro, pode ignorar este e-mail.</p>
        `
    };

    const transporter = await createTransporter();
    await transporter.sendMail(mailOptions);
}

export = {
    sendActivationEmail
};
