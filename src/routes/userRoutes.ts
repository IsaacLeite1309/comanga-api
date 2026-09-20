import express from 'express';
import authModule from '../modules/auth';
import usersModule from '../modules/users';

const router = express.Router();

router.get('/me', authModule.authMiddleware, usersModule.getOwnUserProfile);
router.patch('/me/adult-content', authModule.authMiddleware, usersModule.updateAdultContent);
router.delete('/me', authModule.authMiddleware, usersModule.deleteOwnAccount);
router.get('/:id', authModule.authMiddleware, usersModule.getUserById);
router.put('/:id', authModule.authMiddleware, usersModule.updateUserById);

export = router;
