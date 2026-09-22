import express from 'express';
import authModule from '../modules/auth';
import usersModule from '../modules/users';

const router = express.Router();
router.post('/forgot-password', authModule.createRecoveryRateLimiter(), authModule.requestPasswordReset);
router.post('/reset-password', authModule.createRecoveryRateLimiter(), authModule.resetPassword);

router.post('/register', authModule.registerUser);
router.get('/activate/:token', authModule.activateAccount);
router.post('/resend-activation', authModule.resendActivation);
router.post('/login', authModule.loginRateLimiter, authModule.loginUser);
router.post('/logout', authModule.authMiddleware, authModule.logoutUser);
router.get('/me', authModule.authMiddleware, usersModule.getUserProfile);

export = router;
