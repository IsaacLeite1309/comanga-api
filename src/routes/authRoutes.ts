import express from 'express';
import userController from '../controllers/userController';
import authMiddleware from '../middlewares/authMiddleware';
import loginRateLimiter from '../middlewares/loginRateLimiter';

const router = express.Router();

router.post('/register', userController.registerUser);
router.get('/activate/:token', userController.activateAccount);
router.post('/resend-activation', userController.resendActivation);
router.post('/login', loginRateLimiter.loginRateLimiter, userController.loginUser);
router.post('/logout', authMiddleware, userController.logoutUser);
router.get('/me', authMiddleware, userController.getUserProfile);

export = router;
