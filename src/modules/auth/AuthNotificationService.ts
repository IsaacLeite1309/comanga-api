import type MailService from '../../infrastructure/contracts/MailService';

interface AuthNotificationDependencies {
    mailService: MailService;
}

interface ActivationNotification {
    toEmail: string;
    username: string;
    token: string;
}

function createAuthNotificationService({ mailService }: AuthNotificationDependencies) {
    return {
        sendActivationEmail({ toEmail, username, token }: ActivationNotification): Promise<void> {
            return mailService.sendActivationEmail(toEmail, username, token);
        }
    };
}

export { createAuthNotificationService };
