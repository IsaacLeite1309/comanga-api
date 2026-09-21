import type { NextFunction, Request, Response } from 'express';
import type RateLimitStore from '../../infrastructure/contracts/RateLimitStore';

interface AttemptState { failedAttempts: number; firstFailedAt: number }

interface AttemptRateLimiterOptions {
    store: RateLimitStore<AttemptState>;
    now?: () => number;
    limit: number;
    windowMs: number;
    message: string;
    code: string;
    getKey: (req: Request) => string | undefined;
    isFailure?: (statusCode: number) => boolean;
    isSuccess?: (statusCode: number) => boolean;
}

// Limitador genérico de tentativas: o login conta por IP e a troca de senha conta por conta.
function createAttemptRateLimiter(options: AttemptRateLimiterOptions) {
    const now = options.now || Date.now;
    const isFailure = options.isFailure || ((statusCode: number) => statusCode === 401);
    const isSuccess = options.isSuccess || ((statusCode: number) => statusCode === 200);

    function getActiveAttemptState(key: string): AttemptState | undefined {
        const state = options.store.get(key);
        if (!state) return undefined;
        if (now() - state.firstFailedAt >= options.windowMs) {
            options.store.delete(key);
            return undefined;
        }
        return state;
    }

    function registerFailedAttempt(key: string): void {
        const state = getActiveAttemptState(key);
        options.store.set(key, state
            ? { ...state, failedAttempts: state.failedAttempts + 1 }
            : { failedAttempts: 1, firstFailedAt: now() });
    }

    function middleware(req: Request, res: Response, next: NextFunction) {
        const key = options.getKey(req);
        if (!key) return next();
        const state = getActiveAttemptState(key);
        if (state && state.failedAttempts >= options.limit) {
            return res.status(429).json({ error: options.message, code: options.code });
        }
        res.on('finish', () => {
            if (isFailure(res.statusCode)) registerFailedAttempt(key);
            else if (isSuccess(res.statusCode)) options.store.delete(key);
        });
        return next();
    }

    return { middleware, reset: () => options.store.clear() };
}

export { createAttemptRateLimiter };
export type { AttemptRateLimiterOptions, AttemptState };
