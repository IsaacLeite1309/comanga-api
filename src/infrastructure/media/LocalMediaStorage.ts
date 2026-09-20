import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type MediaStorage from '../contracts/MediaStorage';
import type { PutMediaObjectInput } from '../contracts/MediaStorage';

class LocalMediaStorage implements MediaStorage {
    readonly provider = 'local';
    constructor(private readonly directory: string) {}

    private objectPath(key: string): string {
        if (!key || path.isAbsolute(key) || key.includes('\\')
            || key.split('/').some(part => !part || part === '.' || part === '..')) {
            throw new Error('Chave de mídia local inválida.');
        }
        return path.join(this.directory, key);
    }

    async putObject(input: PutMediaObjectInput): Promise<void> {
        const target = this.objectPath(input.key);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, input.body);
    }

    async deleteObjects(keys: string[]): Promise<void> {
        for (const key of keys) await rm(this.objectPath(key), { force: true });
    }
}

export { LocalMediaStorage };
