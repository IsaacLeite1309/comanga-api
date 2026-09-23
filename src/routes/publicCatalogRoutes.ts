import express from 'express';
import auth from '../modules/auth';
import {
    getPublicCatalogOptions,
    getPublicEditionDetails,
    getPublicVolumeDetails,
    getPublicWorkDetails,
    listPublicEditions,
    listPublicAuthorWorks,
    listPublicWorks
} from '../modules/public-catalog';

const router = express.Router();

router.get('/catalog-options', auth.optionalSessionMiddleware, getPublicCatalogOptions);
router.get('/works', auth.optionalSessionMiddleware, listPublicWorks);
router.get('/works/:slug', auth.optionalSessionMiddleware, getPublicWorkDetails);
router.get('/authors/:authorId/works', auth.optionalSessionMiddleware, listPublicAuthorWorks);
router.get('/editions', auth.optionalSessionMiddleware, listPublicEditions);
router.get('/editions/:editionId', auth.optionalSessionMiddleware, getPublicEditionDetails);
router.get('/volumes/:volumeId', auth.optionalSessionMiddleware, getPublicVolumeDetails);
router.get('/works/:slug/editions/:editionNumber', auth.optionalSessionMiddleware, getPublicEditionDetails);
router.get('/works/:slug/editions/:editionNumber/volumes/:volumeNumber', auth.optionalSessionMiddleware, getPublicVolumeDetails);

export default router;
