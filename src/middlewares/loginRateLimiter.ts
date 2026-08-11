import type { NextFunction, Request, Response } from 'express';

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MESSAGE = 'Muitas tentativas de login. Tente novamente em alguns minutos.';

interface LoginAttemptState {
    failedAttempts: number;
    firstFailedAt: number;
}

const attemptsByIp = new Map<string, LoginAttemptState>();

function getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function getActiveAttemptState(ip: string, now = Date.now()): LoginAttemptState | undefined {
    const state = attemptsByIp.get(ip);

    if (!state) return undefined;

    if (now - state.firstFailedAt >= LOGIN_FAILURE_WINDOW_MS) {
        attemptsByIp.delete(ip);
        return undefined;
    }

    return state;
}

function registerFailedLogin(ip: string, now = Date.now()): void {
    const currentState = getActiveAttemptState(ip, now);

    if (!currentState) {
        attemptsByIp.set(ip, {
            failedAttempts: 1,
            firstFailedAt: now
        });
        return;
    }

    currentState.failedAttempts += 1;
}

function resetLoginAttempts(ip: string): void {
    attemptsByIp.delete(ip);
}

function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
    const ip = getClientIp(req);
    const state = getActiveAttemptState(ip);

    if (state && state.failedAttempts >= LOGIN_FAILURE_LIMIT) {
        return res.status(429).json({
            error: RATE_LIMIT_MESSAGE,
            code: 'LOGIN_RATE_LIMITED'
        });
    }

    res.on('finish', () => {
        if (res.statusCode === 401) {
            registerFailedLogin(ip);
            return;
        }

        if (res.statusCode === 200) {
            resetLoginAttempts(ip);
        }
    });

    return next();
}

function resetLoginRateLimiter() {
    attemptsByIp.clear();
}

export = {
    loginRateLimiter,
    resetLoginRateLimiter,
    RATE_LIMIT_MESSAGE,
    LOGIN_FAILURE_LIMIT,
    LOGIN_FAILURE_WINDOW_MS
};
