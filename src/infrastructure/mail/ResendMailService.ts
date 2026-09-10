import type MailService from '../contracts/MailService';
import mailer from '../../utils/mailer';

class ResendMailService implements MailService {
    constructor(private readonly provider: MailService = mailer) {}

    sendPasswordResetEmail(toEmail: string, username: string, token: string): Promise<void> {
        return this.provider.sendPasswordResetEmail(toEmail, username, token);
    }

    sendActivationEmail(toEmail: string, username: string, token: string): Promise<void> {
        return this.provider.sendActivationEmail(toEmail, username, token);
    }
}

export { ResendMailService };
