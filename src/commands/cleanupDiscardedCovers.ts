import 'dotenv/config';
import prisma from '../prisma';
import { cleanupDiscardedCoverAssets } from '../modules/media';

// Falhas de remoção mantêm o descarte persistido para uma nova tentativa.
void cleanupDiscardedCoverAssets().finally(() => prisma.$disconnect());
