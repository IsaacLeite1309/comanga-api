import express from 'express';
import usersModule from '../modules/users';
import authMiddleware from '../middlewares/authMiddleware';

const router = express.Router();

router.get('/me', authMiddleware, usersModule.getOwnUserProfile);
router.patch('/me/adult-content', authMiddleware, usersModule.updateAdultContent);
router.delete('/me', authMiddleware, usersModule.deleteOwnAccount);
router.get('/:id', authMiddleware, usersModule.getUserById);
router.put('/:id', authMiddleware, usersModule.updateUserById);

export = router;
