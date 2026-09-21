import type { Request } from 'express';
import type RateLimitStore from '../../infrastructure/contracts/RateLimitStore';
import { MemoryRateLimitStore } from '../../infrastructure/rate-limit/MemoryRateLimitStore';
import { createAttemptRateLimiter, type AttemptState } from './attemptRateLimiter';

const PASSWORD_CHANGE_FAILURE_LIMIT = 5;
const PASSWORD_CHANGE_WINDOW_MS = 5 * 60 * 1000;
const PASSWORD_CHANGE_RATE_LIMIT_MESSAGE = 'Muitas tentativas com a senha atual. Tente novamente em alguns minutos.';

interface PasswordChangeRateLimiterDependencies {
    store: RateLimitStore<AttemptState>;
    now?: () => number;
}

// A contagem é por conta autenticada: trocar de IP não zera as tentativas.
function createPasswordChangeRateLimiter({ store, now }: PasswordChangeRateLimiterDependencies) {
    return createAttemptRateLimiter({
        store,
        now,
        limit: PASSWORD_CHANGE_FAILURE_LIMIT,
        windowMs: PASSWORD_CHANGE_WINDOW_MS,
        message: PASSWORD_CHANGE_RATE_LIMIT_MESSAGE,
        code: 'PASSWORD_CHANGE_RATE_LIMITED',
        getKey: (req: Request) => req.user?.userId
    });
}

const defaultPasswordChangeLimiter = createPasswordChangeRateLimiter({
    store: new MemoryRateLimitStore<AttemptState>()
});

export {
    createPasswordChangeRateLimiter,
    defaultPasswordChangeLimiter,
    PASSWORD_CHANGE_FAILURE_LIMIT,
    PASSWORD_CHANGE_RATE_LIMIT_MESSAGE,
    PASSWORD_CHANGE_WINDOW_MS
};
