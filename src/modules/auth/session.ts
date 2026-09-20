import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';

function hashSessionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function shouldUseSecureCookie(req: Request): boolean {
    if (process.env.COOKIE_SECURE === 'true') return true;
    if (process.env.COOKIE_SECURE === 'false') return false;
    return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
}

function getSessionCookieOptions(req: Request): CookieOptions {
    return {
        httpOnly: true,
        secure: shouldUseSecureCookie(req),
        sameSite: process.env.COOKIE_SAME_SITE as CookieOptions['sameSite'] || 'strict',
        path: '/'
    };
}

function setSessionCookie(req: Request, res: Response, token: string): void {
    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(req));
}

function clearSessionCookie(req: Request, res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    for (const pair of (cookieHeader || '').split(';')) {
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = pair.slice(0, separatorIndex).trim();
        if (key !== name) continue;

        try {
            return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
        } catch {
            return undefined;
        }
    }

    return undefined;
}

function readSessionToken(req: Request): string | undefined {
    return readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
}

export {
    SESSION_COOKIE_NAME,
    clearSessionCookie,
    getSessionCookieOptions,
    hashSessionToken,
    readCookie,
    readSessionToken,
    setSessionCookie
};
