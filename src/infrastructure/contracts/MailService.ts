interface MailService {
    sendPasswordResetEmail(toEmail: string, username: string, token: string): Promise<void>;
    sendActivationEmail(toEmail: string, username: string, token: string): Promise<void>;
}

export = MailService;
