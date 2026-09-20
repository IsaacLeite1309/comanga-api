import { mailService } from '../../infrastructure/container';
import { createAuthNotificationService } from './AuthNotificationService';
import { isAdult } from './accountRules';
import { requireRole } from './authorization';
import { createAuthHandlers } from './handlers';
import { defaultLimiter } from './loginRateLimiter';
import { createPasswordRecoveryHandlers } from './passwordRecovery';
import { createRecoveryRateLimiter } from './recoveryRateLimiter';
import { clearSessionCookie } from './session';
import { authMiddleware, optionalSessionMiddleware } from './sessionMiddleware';

const notifications = createAuthNotificationService({ mailService });

export = {
    ...createAuthHandlers(notifications),
    ...createPasswordRecoveryHandlers(notifications),
    authMiddleware,
    optionalSessionMiddleware,
    requireRole,
    loginRateLimiter: defaultLimiter.middleware,
    createRecoveryRateLimiter,
    isAdult,
    clearSessionCookie
};
