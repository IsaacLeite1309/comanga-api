require('dotenv').config();
const prisma = require('../dist/src/prisma');
const { cleanupDiscardedCoverAssets } = require('../dist/src/modules/admin/media/coverAssetLifecycle');
// Operates only on durable discard claims. Failed deletions remain available for retry.
cleanupDiscardedCoverAssets().finally(() => prisma.$disconnect());
