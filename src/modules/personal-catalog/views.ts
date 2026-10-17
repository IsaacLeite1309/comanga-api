import type { Prisma } from '@prisma/client';
import { mapCoverUrl } from '../public-catalog';
import { editionSelect, volumeSelect } from './queries';

type Edition = Prisma.EditionGetPayload<{ select: typeof editionSelect }>;
type Volume = Prisma.VolumeGetPayload<{ select: typeof volumeSelect }>;

function pagination(page: number, limit: number, total: number) {
    return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
function mapWork(work: Edition['work']) {
    return { id: work.id, slug: work.slug, title: work.title, coverUrl: mapCoverUrl(work.coverAsset) };
}
function mapEdition(edition: Edition) {
    return { id: edition.id, chronologicalNumber: edition.chronologicalNumber, brazilianPublisher: edition.brazilianPublisher };
}
function mapVolume(volume: Volume) {
    return { id: volume.id, number: volume.number, singleVolume: volume.singleVolume, coverUrl: mapCoverUrl(volume.coverAsset) };
}
export { pagination, mapWork, mapEdition, mapVolume };
