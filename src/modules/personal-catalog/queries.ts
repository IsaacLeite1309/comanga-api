import type { Prisma } from '@prisma/client';
import { buildAdultWorkRestriction } from '../public-catalog';

function visibleWork(canViewAdult: boolean): Prisma.WorkWhereInput {
    return { visibility: 'Público', ...buildAdultWorkRestriction(canViewAdult) };
}
function visibleEdition(canViewAdult: boolean): Prisma.EditionWhereInput {
    return { visibility: 'Público', work: visibleWork(canViewAdult) };
}
function visibleVolume(canViewAdult: boolean): Prisma.VolumeWhereInput {
    return { visibility: 'Público', edition: visibleEdition(canViewAdult) };
}
export { visibleWork, visibleEdition, visibleVolume };
