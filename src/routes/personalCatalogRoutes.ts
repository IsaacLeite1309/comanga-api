import express from 'express';
import auth from '../modules/auth';
import * as personal from '../modules/personal-catalog';

const router = express.Router();
router.use(auth.authMiddleware, auth.optionalSessionMiddleware);
router.put('/collection/editions/:editionId', personal.putEdition);
router.put('/collection/volumes/:volumeId', personal.putOwned);
router.patch('/collection/volumes/:volumeId', personal.patchRead);
router.delete('/collection/volumes/:volumeId', personal.deleteOwned);
router.put('/wishlist/volumes/:volumeId', personal.putWanted);
router.delete('/wishlist/volumes/:volumeId', personal.deleteWanted);
export = router;
