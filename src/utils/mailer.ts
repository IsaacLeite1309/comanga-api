import ApplicationError from '../errors/ApplicationError';

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

async function sendEmail(to: string, username: string, token: string, recovery: boolean): Promise<void> {
    const { RESEND_API_KEY, RESEND_FROM } = process.env;
    if (!RESEND_API_KEY || !RESEND_FROM) {
        throw new ApplicationError({ statusCode: 503, code: 'EMAIL_NOT_CONFIGURED', message: 'Serviço de e-mail não configurado.' });
    }
    const frontend = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:8080').split(',')[0].trim().replace(/\/$/, '');
    const link = `${frontend}/${recovery ? 'redefinir-senha' : 'activate'}/${encodeURIComponent(token)}`;
    const action = recovery ? 'Redefinir minha senha' : 'Ativar minha conta';
    const instruction = recovery ? 'O link de recuperação vale por 1 hora e só pode ser usado uma vez.' : 'Confirme seu cadastro para liberar o acesso ao CoMangá.';
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
                from: RESEND_FROM, to: [to],
                subject: recovery ? 'CoMangá - Redefina sua senha' : 'CoMangá - Ative sua conta!',
                text: `Olá, ${username}! ${instruction} ${action}: ${link} Se você não solicitou, ignore este e-mail.`,
                html: `<h2>Olá, ${escapeHtml(username)}!</h2><p>${instruction}</p><a href="${escapeHtml(link)}">${action}</a><p>Se você não solicitou, ignore este e-mail.</p>`
            })
        });
        // Provider responses can contain recipient information: never propagate their body.
        if (!response.ok) throw new Error();
    } catch {
        throw new ApplicationError({ statusCode: 502, code: 'EMAIL_DELIVERY_FAILED', message: 'Não foi possível enviar o e-mail.' });
    }
}

export = {
    sendActivationEmail: (to: string, username: string, token: string) => sendEmail(to, username, token, false),
    sendPasswordResetEmail: (to: string, username: string, token: string) => sendEmail(to, username, token, true)
};
