import type MailService from '../../infrastructure/contracts/MailService';

interface AuthNotificationDependencies {
    mailService: MailService;
}

interface AccountNotification {
    toEmail: string;
    username: string;
    token: string;
}

function createAuthNotificationService({ mailService }: AuthNotificationDependencies) {
    return {
        sendPasswordResetEmail({ toEmail, username, token }: AccountNotification): Promise<void> {
            return mailService.sendPasswordResetEmail(toEmail, username, token);
        },
        sendActivationEmail({ toEmail, username, token }: AccountNotification): Promise<void> {
            return mailService.sendActivationEmail(toEmail, username, token);
        }
    };
}

export { createAuthNotificationService };
