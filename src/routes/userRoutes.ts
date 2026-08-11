import express from 'express';
import userController from '../controllers/userController';
import authMiddleware from '../middlewares/authMiddleware';

const router = express.Router();

router.get('/me', authMiddleware, userController.getOwnUserProfile);
router.patch('/me/adult-content', authMiddleware, userController.updateAdultContent);
router.delete('/me', authMiddleware, userController.deleteOwnAccount);
router.get('/:id', authMiddleware, userController.getUserById);
router.put('/:id', authMiddleware, userController.updateUserById);

export = router;
