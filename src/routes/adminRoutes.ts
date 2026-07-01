import express from 'express';
import adminController from '../controllers/adminController';
import authMiddleware from '../middlewares/authMiddleware';
import rbacMiddleware from '../middlewares/rbacMiddleware';

const router = express.Router();
const requireAdmin = rbacMiddleware.requireRole('Administrador');

router.get('/users', authMiddleware, requireAdmin, adminController.listUsers);
router.patch('/users/:id/role', authMiddleware, requireAdmin, adminController.updateUserRole);

export = router;
