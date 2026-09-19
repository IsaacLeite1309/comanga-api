import { z } from 'zod';

export function parseBirthDate(value: unknown, now = new Date()): Date | null {
    if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return value <= now.toISOString().slice(0, 10) ? date : null;
}

export function isAdult(birthDate: Date | null | undefined, now = new Date()): boolean {
    if (!birthDate || !Number.isFinite(birthDate.getTime())) return false;
    let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
    if (now.getUTCMonth() < birthDate.getUTCMonth()
        || (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate())) age--;
    return age >= 18;
}

export const birthDateSchema = z.string().refine(value => parseBirthDate(value) !== null,
    'Informe uma data de nascimento válida e não futura (YYYY-MM-DD).');
export const passwordSchema = z.string().regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/,
    'Utilize no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial.')
    .refine(value => Buffer.byteLength(value, 'utf8') <= 72,
        'A senha deve ter no máximo 72 bytes em UTF-8; acentos e emojis podem ocupar mais de um byte.');
