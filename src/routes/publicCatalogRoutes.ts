import express from 'express';
import optionalSessionMiddleware from '../middlewares/optionalSessionMiddleware';
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

router.get('/catalog-options', getPublicCatalogOptions);
router.get('/works', optionalSessionMiddleware, listPublicWorks);
router.get('/works/:slug', optionalSessionMiddleware, getPublicWorkDetails);
router.get('/authors/:authorId/works', optionalSessionMiddleware, listPublicAuthorWorks);
router.get('/editions', optionalSessionMiddleware, listPublicEditions);
router.get('/editions/:editionId', optionalSessionMiddleware, getPublicEditionDetails);
router.get('/volumes/:volumeId', optionalSessionMiddleware, getPublicVolumeDetails);

export default router;
