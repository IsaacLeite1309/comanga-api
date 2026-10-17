import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { buildAdultWorkRestriction, canViewAdultContent } from './adultContentPolicy';

interface PersonalVolumeState {
    owned: boolean;
    read: boolean | null;
    wished: boolean;
}

interface PersonalSummary {
    ownedCount: number;
    readCount: number;
    wishedCount: number;
}

interface PersonalCatalogState {
    volumes: Map<number, PersonalVolumeState>;
    editions: Map<number, PersonalSummary>;
    total: PersonalSummary;
}

function emptySummary(): PersonalSummary {
    return { ownedCount: 0, readCount: 0, wishedCount: 0 };
}

function countState(summary: PersonalSummary, state: PersonalVolumeState) {
    if (state.owned) summary.ownedCount++;
    if (state.read) summary.readCount++;
    if (state.wished) summary.wishedCount++;
}

async function loadPersonalCatalogState(
    req: Request,
    scope: { workId?: number; editionId?: number; volumeId?: number }
): Promise<PersonalCatalogState | undefined> {
    const userId = req.publicCatalogViewer?.userId;
    if (!userId) return undefined;
    const volume: Prisma.VolumeWhereInput = {
        ...(scope.volumeId !== undefined ? { id: scope.volumeId } : {}),
        visibility: 'Público',
        edition: {
            ...(scope.editionId !== undefined ? { id: scope.editionId } : {}),
            visibility: 'Público',
            work: {
                ...(scope.workId !== undefined ? { id: scope.workId } : {}),
                visibility: 'Público',
                ...buildAdultWorkRestriction(canViewAdultContent(req))
            }
        }
    };
    const rows = await prisma.userVolume.findMany({
        where: { userId, volume },
        select: { volumeId: true, state: true, read: true, volume: { select: { editionId: true } } }
    });
    const result: PersonalCatalogState = { volumes: new Map(), editions: new Map(), total: emptySummary() };
    for (const row of rows) {
        const state = { owned: row.state === 'Owned', read: row.state === 'Owned' ? row.read : null, wished: row.state === 'Wanted' };
        result.volumes.set(row.volumeId, state);
        const summary = result.editions.get(row.volume.editionId) ?? emptySummary();
        countState(summary, state);
        countState(result.total, state);
        result.editions.set(row.volume.editionId, summary);
    }
    return result;
}

function personalVolumeFields(state: PersonalCatalogState | undefined, volumeId: number) {
    return state ? { personal: state.volumes.get(volumeId) ?? { owned: false, read: null, wished: false } } : {};
}

function personalSummaryFields(state: PersonalCatalogState | undefined, editionId?: number) {
    if (!state) return {};
    return { personal: editionId === undefined ? state.total : state.editions.get(editionId) ?? emptySummary() };
}

function enrichPublicWork<T extends { editions: Array<{ id: number; volumes: Array<{ id: number }> }> }>(
    work: T,
    state: PersonalCatalogState | undefined
) {
    if (!state) return work;
    return {
        ...work,
        ...personalSummaryFields(state),
        editions: work.editions.map(edition => ({
            ...edition,
            ...personalSummaryFields(state, edition.id),
            volumes: edition.volumes.map(volume => ({ ...volume, ...personalVolumeFields(state, volume.id) }))
        }))
    };
}

export { loadPersonalCatalogState, personalVolumeFields, personalSummaryFields, enrichPublicWork };
