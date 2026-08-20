import express from 'express';
import adminController from '../controllers/adminController';
import authMiddleware from '../middlewares/authMiddleware';
import rbacMiddleware from '../middlewares/rbacMiddleware';

const router = express.Router();
const requireAdmin = rbacMiddleware.requireRole('Administrador');

router.get('/users', authMiddleware, requireAdmin, adminController.listUsers);
router.patch('/users/:id/role', authMiddleware, requireAdmin, adminController.updateUserRole);
router.get('/options/:category', authMiddleware, requireAdmin, adminController.listOptions);
router.post('/options', authMiddleware, requireAdmin, adminController.createOption);
router.patch('/options/:id', authMiddleware, requireAdmin, adminController.updateOption);
router.delete('/options/:id', authMiddleware, requireAdmin, adminController.deleteOption);
router.post('/media/covers', authMiddleware, requireAdmin, adminController.importCover);
router.delete('/media/covers/:assetId', authMiddleware, requireAdmin, adminController.deletePendingCover);
router.get('/works/form-options', authMiddleware, requireAdmin, adminController.getWorkFormOptions);
router.get('/editions/form-options', authMiddleware, requireAdmin, adminController.getEditionFormOptions);
router.get('/works', authMiddleware, requireAdmin, adminController.listWorks);
router.post('/works', authMiddleware, requireAdmin, adminController.createWork);
router.get('/works/slug/:slug', authMiddleware, requireAdmin, adminController.getWorkBySlug);
router.post('/works/:workId/editions', authMiddleware, requireAdmin, adminController.createEdition);
router.get('/works/:workId/editions', authMiddleware, requireAdmin, adminController.listEditionsByWork);
router.post('/editions/:editionId/volumes', authMiddleware, requireAdmin, adminController.createVolume);
router.get('/editions/:editionId/volumes', authMiddleware, requireAdmin, adminController.listVolumesByEdition);
router.patch('/works/:id/visibility', authMiddleware, requireAdmin, adminController.updateWorkVisibility);
router.get('/works/:id', authMiddleware, requireAdmin, adminController.getWorkById);
router.patch('/works/:id', authMiddleware, requireAdmin, adminController.updateWork);
router.delete('/works/:id', authMiddleware, requireAdmin, adminController.deleteWork);
router.get('/editions/:id', authMiddleware, requireAdmin, adminController.getEditionById);
router.patch('/editions/:id', authMiddleware, requireAdmin, adminController.updateEdition);
router.delete('/editions/:id', authMiddleware, requireAdmin, adminController.deleteEdition);
router.patch('/editions/:id/visibility', authMiddleware, requireAdmin, adminController.updateEditionVisibility);
router.get('/volumes/:id', authMiddleware, requireAdmin, adminController.getVolumeById);
router.patch('/volumes/:id', authMiddleware, requireAdmin, adminController.updateVolume);
router.delete('/volumes/:id', authMiddleware, requireAdmin, adminController.deleteVolume);

export = router;
