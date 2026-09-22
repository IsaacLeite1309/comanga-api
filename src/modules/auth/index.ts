import { mailService } from '../../infrastructure/container';
import { createAuthNotificationService } from './AuthNotificationService';
import { isAdult, passwordSchema, usernameSchema } from './accountRules';
import { requireRole } from './authorization';
import { createAuthHandlers } from './handlers';
import { defaultLimiter } from './loginRateLimiter';
import { defaultPasswordChangeLimiter } from './passwordChangeRateLimiter';
import { createPasswordRecoveryHandlers } from './passwordRecovery';
import {
    ADMIN_PROFILE_CODE,
    ADMIN_PROFILE_NAME,
    DEFAULT_PROFILE_CODE,
    DEFAULT_PROFILE_NAME,
    LAST_ADMIN_MESSAGE,
    SYSTEM_PROFILE_NAMES,
    anotherEffectiveAdminRemains,
    findProfileByCode,
    findProfileByName,
    grantAdminProfile,
    listProfileNamesByUser,
    lockAdminAssignments,
    lockUserRow,
    requireProfileByCode,
    resolveActiveProfileName,
    revokeAdminProfile,
    sortProfileNames
} from './profiles';
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
    passwordChangeRateLimiter: defaultPasswordChangeLimiter.middleware,
    createRecoveryRateLimiter,
    isAdult,
    passwordSchema,
    usernameSchema,
    clearSessionCookie,
    ADMIN_PROFILE_CODE,
    ADMIN_PROFILE_NAME,
    DEFAULT_PROFILE_CODE,
    DEFAULT_PROFILE_NAME,
    LAST_ADMIN_MESSAGE,
    SYSTEM_PROFILE_NAMES,
    anotherEffectiveAdminRemains,
    findProfileByCode,
    findProfileByName,
    grantAdminProfile,
    listProfileNamesByUser,
    lockAdminAssignments,
    lockUserRow,
    requireProfileByCode,
    resolveActiveProfileName,
    sortProfileNames,
    revokeAdminProfile
};
