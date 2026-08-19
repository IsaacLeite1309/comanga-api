import express from 'express';
import optionalSessionMiddleware from '../middlewares/optionalSessionMiddleware';
import {
    getPublicCatalogOptions,
    listPublicEditions,
    listPublicWorks
} from '../modules/public-catalog';

const router = express.Router();

router.get('/catalog-options', getPublicCatalogOptions);
router.get('/works', optionalSessionMiddleware, listPublicWorks);
router.get('/editions', optionalSessionMiddleware, listPublicEditions);

export default router;
