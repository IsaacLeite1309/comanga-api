import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type MailService from '../contracts/MailService';

class LocalMailService implements MailService {
    constructor(private readonly directory: string) {}

    private async save(to: string, username: string, token: string, route: string) {
        const origin = process.env.FRONTEND_URL || 'http://localhost:8080';
        const link = `${origin.replace(/\/$/, '')}/${route}/${encodeURIComponent(token)}`;
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await writeFile(path.join(this.directory, `${Date.now()}-${randomUUID()}.json`),
            JSON.stringify({ to, username, type: route, link }, null, 2), { mode: 0o600 });
    }

    sendActivationEmail(to: string, username: string, token: string) {
        return this.save(to, username, token, 'activate');
    }

    sendPasswordResetEmail(to: string, username: string, token: string) {
        return this.save(to, username, token, 'redefinir-senha');
    }
}

export { LocalMailService };
