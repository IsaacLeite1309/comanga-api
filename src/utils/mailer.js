// src/utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "sandbox.smtp.mailtrap.io",
    port: process.env.SMTP_PORT || 2525,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

exports.sendActivationEmail = async (toEmail, username, token) => {
    // Em produção, isso apontaria para a URL do Front-end (React)
    const frontendUrl = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:8080')
        .split(',')[0]
        .trim()
        .replace(/\/$/, '');
    const activationLink = `${frontendUrl}/activate/${token}`;

    const mailOptions = {
        from: '"Equipe CoMangá" <noreply@comanga.com>',
        to: toEmail,
        subject: 'CoMangá - Ative sua conta!',
        html: `
            <h2>Olá, ${username}!</h2>
            <p>Obrigado por se cadastrar no CoMangá. Para liberar seu acesso, clique no link abaixo:</p>
            <a href="${activationLink}" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Ativar minha conta</a>
            <p>Se você não solicitou este cadastro, pode ignorar este e-mail.</p>
        `
    };

    await transporter.sendMail(mailOptions);
};
