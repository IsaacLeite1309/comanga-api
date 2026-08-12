interface MailService {
    sendActivationEmail(toEmail: string, username: string, token: string): Promise<void>;
}

export = MailService;
