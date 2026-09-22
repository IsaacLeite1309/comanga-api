import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';

// O mesmo lock usado pelos gatilhos de mídia, adquirido antes das leituras e
// dos locks de linha. Publicação e escrita de Volumes veem um estado coerente.
function withCatalogWriteLock<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(9142026)::text`;
        return operation(tx);
    });
}

export { withCatalogWriteLock };
