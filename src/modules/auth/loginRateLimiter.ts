import type { Request } from 'express';
import type RateLimitStore from '../../infrastructure/contracts/RateLimitStore';
import { MemoryRateLimitStore } from '../../infrastructure/rate-limit/MemoryRateLimitStore';
import { createAttemptRateLimiter, type AttemptState } from './attemptRateLimiter';

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MESSAGE = 'Muitas tentativas de login. Tente novamente em alguns minutos.';

type LoginAttemptState = AttemptState;
interface LoginRateLimiterDependencies { store: RateLimitStore<LoginAttemptState>; now?: () => number }

function getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function createLoginRateLimiter({ store, now }: LoginRateLimiterDependencies) {
    return createAttemptRateLimiter({
        store,
        now,
        limit: LOGIN_FAILURE_LIMIT,
        windowMs: LOGIN_FAILURE_WINDOW_MS,
        message: RATE_LIMIT_MESSAGE,
        code: 'LOGIN_RATE_LIMITED',
        getKey: getClientIp
    });
}

const defaultLimiter = createLoginRateLimiter({
    store: new MemoryRateLimitStore<LoginAttemptState>()
});

export {
    createLoginRateLimiter,
    defaultLimiter,
    LOGIN_FAILURE_LIMIT,
    LOGIN_FAILURE_WINDOW_MS,
    RATE_LIMIT_MESSAGE
};
