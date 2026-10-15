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
const coverSelect = {
    objectKey: true,
    variants: { select: { kind: true, objectKey: true } }
} satisfies Prisma.MediaAssetSelect;
const workSelect = {
    id: true, slug: true, title: true, coverAsset: { select: coverSelect }
} satisfies Prisma.WorkSelect;
const editionSelect = {
    id: true, chronologicalNumber: true,
    brazilianPublisher: { select: { id: true, label: true } },
    work: { select: workSelect }
} satisfies Prisma.EditionSelect;
const volumeSelect = {
    id: true, number: true, singleVolume: true, coverAsset: { select: coverSelect }
} satisfies Prisma.VolumeSelect;
const volumeOrder = [{ number: 'asc' }, { id: 'asc' }] satisfies Prisma.VolumeOrderByWithRelationInput[];

export { visibleWork, visibleEdition, visibleVolume, editionSelect, workSelect, volumeSelect, volumeOrder };
