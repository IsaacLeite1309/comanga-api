import type { NextFunction, Request, Response } from 'express';
import type RateLimitStore from '../infrastructure/contracts/RateLimitStore';
import { MemoryRateLimitStore } from '../infrastructure/rate-limit/MemoryRateLimitStore';

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MESSAGE = 'Muitas tentativas de login. Tente novamente em alguns minutos.';

interface LoginAttemptState {
    failedAttempts: number;
    firstFailedAt: number;
}

interface LoginRateLimiterDependencies {
    store: RateLimitStore<LoginAttemptState>;
    now?: () => number;
}

function getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function createLoginRateLimiter({ store, now = Date.now }: LoginRateLimiterDependencies) {
    function getActiveAttemptState(ip: string): LoginAttemptState | undefined {
        const state = store.get(ip);

        if (!state) return undefined;

        if (now() - state.firstFailedAt >= LOGIN_FAILURE_WINDOW_MS) {
            store.delete(ip);
            return undefined;
        }

        return state;
    }

    function registerFailedLogin(ip: string): void {
        const currentState = getActiveAttemptState(ip);

        if (!currentState) {
            store.set(ip, {
                failedAttempts: 1,
                firstFailedAt: now()
            });
            return;
        }

        store.set(ip, {
            ...currentState,
            failedAttempts: currentState.failedAttempts + 1
        });
    }

    function resetLoginAttempts(ip: string): void {
        store.delete(ip);
    }

    function middleware(req: Request, res: Response, next: NextFunction) {
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

    return {
        middleware,
        reset: () => store.clear()
    };
}

const defaultLimiter = createLoginRateLimiter({
    store: new MemoryRateLimitStore<LoginAttemptState>()
});

export = {
    createLoginRateLimiter,
    loginRateLimiter: defaultLimiter.middleware,
    resetLoginRateLimiter: defaultLimiter.reset,
    RATE_LIMIT_MESSAGE,
    LOGIN_FAILURE_LIMIT,
    LOGIN_FAILURE_WINDOW_MS
};
