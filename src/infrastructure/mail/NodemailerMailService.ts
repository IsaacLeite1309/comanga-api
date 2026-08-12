import type MailService from '../contracts/MailService';
import mailer from '../../utils/mailer';

interface ActivationMailProvider {
    sendActivationEmail(toEmail: string, username: string, token: string): Promise<void>;
}

class NodemailerMailService implements MailService {
    constructor(private readonly provider: ActivationMailProvider = mailer) {}

    sendActivationEmail(toEmail: string, username: string, token: string): Promise<void> {
        return this.provider.sendActivationEmail(toEmail, username, token);
    }
}

export { NodemailerMailService };
