// src/utils/mailer.js
const nodemailer = require('nodemailer');

function getRequiredSmtpConfig() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        const error = new Error('Servico de e-mail nao configurado.');
        error.code = 'SMTP_NOT_CONFIGURED';
        throw error;
    }

    return {
        host: SMTP_HOST,
        port: Number(SMTP_PORT || 587),
        secure: SMTP_SECURE === 'true',
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    };
}

function createTransporter() {
    return nodemailer.createTransport(getRequiredSmtpConfig());
}

exports.sendActivationEmail = async (toEmail, username, token) => {
    // Em produção, isso apontaria para a URL do Front-end (React)
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

    await createTransporter().sendMail(mailOptions);
};
