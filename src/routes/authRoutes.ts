import express from 'express';
import authModule from '../modules/auth';
import usersModule from '../modules/users';
import authMiddleware from '../middlewares/authMiddleware';
import loginRateLimiter from '../middlewares/loginRateLimiter';

const router = express.Router();

router.post('/register', authModule.registerUser);
router.get('/activate/:token', authModule.activateAccount);
router.post('/resend-activation', authModule.resendActivation);
router.post('/login', loginRateLimiter.loginRateLimiter, authModule.loginUser);
router.post('/logout', authMiddleware, authModule.logoutUser);
router.get('/me', authMiddleware, usersModule.getUserProfile);

export = router;
