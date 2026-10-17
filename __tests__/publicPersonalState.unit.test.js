const mockFindMany = jest.fn();
jest.mock('../src/prisma', () => ({ __esModule: true, default: { userVolume: { findMany: mockFindMany } } }));
const { loadPersonalCatalogState, personalVolumeFields, personalSummaryFields, enrichPublicWork } = require('../src/modules/public-catalog/personalState');

beforeEach(() => { mockFindMany.mockReset(); });

it('anônimo não consulta relações pessoais e não adiciona campos', async () => {
    expect(await loadPersonalCatalogState({}, { workId: 1 })).toBeUndefined();
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(personalVolumeFields(undefined, 1)).toEqual({});
    expect(personalSummaryFields(undefined)).toEqual({});
    const work = { editions: [] };
    expect(enrichPublicWork(work, undefined)).toBe(work);
});

it('consulta apenas própria sessão na hierarquia pública e mapeia os mínimos estados', async () => {
    mockFindMany.mockResolvedValue([
        { volumeId: 1, state: 'Owned', read: true, volume: { editionId: 2 } },
        { volumeId: 3, state: 'Owned', read: false, volume: { editionId: 2 } },
        { volumeId: 4, state: 'Wanted', read: null, volume: { editionId: 5 } }
    ]);
    const state = await loadPersonalCatalogState({ publicCatalogViewer: { userId: 'own-session', canViewAdultContent: true } }, { workId: 9, editionId: 2, volumeId: 1 });
    expect(mockFindMany.mock.calls[0][0]).toMatchObject({
        where: { userId: 'own-session', volume: { id: 1, visibility: 'Público', edition: { id: 2, visibility: 'Público', work: { id: 9, visibility: 'Público' } } } },
        select: { volumeId: true, state: true, read: true, volume: { select: { editionId: true } } }
    });
    expect(personalSummaryFields(state)).toEqual({ personal: { ownedCount: 2, readCount: 1, wishedCount: 1 } });
    expect(personalSummaryFields(state, 2)).toEqual({ personal: { ownedCount: 2, readCount: 1, wishedCount: 0 } });
    expect(personalSummaryFields(state, 99)).toEqual({ personal: { ownedCount: 0, readCount: 0, wishedCount: 0 } });
    expect(personalVolumeFields(state, 99)).toEqual({ personal: { owned: false, read: null, wished: false } });
    const enriched = enrichPublicWork({ id: 9, editions: [{ id: 2, volumes: [{ id: 1 }, { id: 99 }] }, { id: 5, volumes: [{ id: 4 }] }] }, state);
    expect(enriched.editions[0].volumes[0].personal).toEqual({ owned: true, read: true, wished: false });
    expect(enriched.editions[1].volumes[0].personal).toEqual({ owned: false, read: null, wished: true });
});

it('falha pessoal propaga ao handler sem retornar estado de outra conta', async () => {
    mockFindMany.mockRejectedValue(new Error('database unavailable'));
    await expect(loadPersonalCatalogState({ publicCatalogViewer: { userId: 'own-session', canViewAdultContent: false } }, { workId: 9 })).rejects.toThrow('database unavailable');
    expect(mockFindMany.mock.calls[0][0].where.volume.edition.work).toMatchObject({ adultContent: false });
});
