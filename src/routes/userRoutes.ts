import express from 'express';
import authModule from '../modules/auth';
import usersModule from '../modules/users';

const router = express.Router();

router.get('/me', authModule.authMiddleware, usersModule.getOwnUserProfile);
router.patch('/me/adult-content', authModule.authMiddleware, usersModule.updateAdultContent);
router.patch('/me/active-profile', authModule.authMiddleware, usersModule.updateActiveProfile);
router.patch('/me/username', authModule.authMiddleware, usersModule.updateOwnUsername);
router.patch(
    '/me/password',
    authModule.authMiddleware,
    authModule.passwordChangeRateLimiter,
    usersModule.updateOwnPassword
);
router.delete('/me', authModule.authMiddleware, usersModule.deleteOwnAccount);

export = router;
