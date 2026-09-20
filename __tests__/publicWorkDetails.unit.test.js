const mockFindFirst = jest.fn();
const mockVolumeFindMany = jest.fn();

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: {
        work: { findFirst: mockFindFirst },
        volume: { findMany: mockVolumeFindMany }
    }
}));

const { getPublicWorkDetails } = require('../src/modules/public-catalog');
const {
    publicEditionCoverSourceVolumeSelect,
    publicWorkDetailSelect
} = require('../src/modules/public-catalog/queries');

function response() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        vary: jest.fn(() => res),
        set: jest.fn(() => res)
    };
    return res;
}

function cover(id) {
    return {
        objectKey: `covers/${id}/master.webp`,
        variants: [{ kind: 'COVER_LARGE', objectKey: `covers/${id}/large.webp` }]
    };
}

function workFixture() {
    return {
        id: 8,
        slug: 'lobo-solitario',
        title: 'Lobo Solitário',
        originalTitle: '子連れ狼',
        romanizedTitle: 'Kozure Ōkami',
        synopsis: 'A sinopse canônica da Obra.',
        originalPublicationStartYear: 1970,
        originalPublicationEndYear: 1976,
        originalVolumeCount: 28,
        directRelease: false,
        country: 'Japão',
        originalPublicationStatus: 'Finalizada',
        coverAsset: cover('work'),
        type: { id: 1, label: 'Mangá' },
        authors: [{
            position: 0,
            author: { id: 2, label: 'Kazuo Koike' },
            roles: [{ role: 'Roteiro' }]
        }],
        genres: [{ genre: { id: 3, label: 'Drama' } }],
        demographics: [{ demography: 'Seinen' }],
        serializationMagazines: [{ magazine: { id: 4, label: 'Manga Action' } }],
        originalPublishers: [{ publisher: { id: 5, label: 'Futabasha' } }],
        editions: [{
            id: 10,
            chronologicalNumber: 1,
            brazilPublicationStatus: 'Em publicação',
            brazilianPublisher: { id: 6, label: 'Panini' },
            editionType: { id: 7, label: 'Regular' },
            format: { id: 8, label: 'Tankobon' },
            coverType: { id: 9, label: 'Brochura' },
            _count: { volumes: 4 },
            volumes: [{
                id: 20,
                number: 1,
                singleVolume: false,
                releaseDatePrecision: 'Completa',
                releaseYear: 2025,
                releaseMonth: 8,
                releaseDay: 20,
                coverAsset: cover('volume')
            }]
        }]
    };
}

const HENTAI_RESTRICTION = { genres: { none: { genre: { code: 'hentai', category: { slug: 'generos' } } } } };

describe('detalhes públicos da Obra', () => {
    const previousMediaUrl = process.env.MEDIA_PUBLIC_BASE_URL;

    beforeAll(() => {
        process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.comanga.test';
    });

    afterAll(() => {
        if (previousMediaUrl === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
        else process.env.MEDIA_PUBLIC_BASE_URL = previousMediaUrl;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockVolumeFindMany.mockResolvedValue([]);
    });

    it('projeta ficha completa, Edições públicas e amostra limitada de Volumes públicos', async () => {
        mockFindFirst.mockResolvedValue(workFixture());
        mockVolumeFindMany.mockResolvedValue([{ editionId: 10, coverAsset: cover('volume-1') }]);
        const res = response();

        await getPublicWorkDetails({
            params: { slug: 'lobo-solitario' },
            publicCatalogViewer: { canViewAdultContent: false }
        }, res, jest.fn());

        expect(mockFindFirst).toHaveBeenCalledWith({
            where: {
                slug: 'lobo-solitario',
                visibility: 'Público',
                adultContent: false,
                ...HENTAI_RESTRICTION
            },
            select: publicWorkDetailSelect
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            work: expect.objectContaining({
                slug: 'lobo-solitario',
                coverUrl: 'https://media.comanga.test/covers/work/large.webp',
                originalTitle: '子連れ狼',
                romanizedTitle: 'Kozure Ōkami',
                synopsis: 'A sinopse canônica da Obra.',
                authors: [{ id: 2, label: 'Kazuo Koike', roles: ['Roteiro'] }],
                genres: [{ id: 3, label: 'Drama' }],
                demographics: ['Seinen'],
                editions: [expect.objectContaining({
                    id: 10,
                    coverUrl: 'https://media.comanga.test/covers/volume-1/large.webp',
                    volumesCount: 4,
                    volumes: [expect.objectContaining({
                        id: 20,
                        coverUrl: 'https://media.comanga.test/covers/volume/large.webp'
                    })]
                })]
            })
        });
        expect(res.vary).toHaveBeenCalledWith('Cookie');
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it('só omite a restrição adulta para uma sessão elegível', async () => {
        mockFindFirst.mockResolvedValue(workFixture());

        await getPublicWorkDetails({
            params: { slug: 'lobo-solitario' },
            publicCatalogViewer: { canViewAdultContent: true }
        }, response(), jest.fn());

        expect(mockFindFirst.mock.calls[0][0].where).toEqual({
            slug: 'lobo-solitario',
            visibility: 'Público'
        });
    });

    it('não usa a sinopse de nenhum Volume, nem da primeira nem de outra Edição', async () => {
        const work = workFixture();
        work.synopsis = 'Somente a sinopse própria da Obra.';
        work.editions[0].volumes[0].synopsis = 'Sinopse do Volume 1.';
        work.editions.push({
            ...work.editions[0],
            id: 11,
            chronologicalNumber: 2,
            volumes: [{
                ...work.editions[0].volumes[0],
                id: 21,
                synopsis: 'Sinopse de uma Edição posterior.'
            }]
        });
        mockFindFirst.mockResolvedValue(work);
        const res = response();

        await getPublicWorkDetails({
            params: { slug: 'lobo-solitario' },
            publicCatalogViewer: { canViewAdultContent: false }
        }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith({
            work: expect.objectContaining({ synopsis: 'Somente a sinopse própria da Obra.' })
        });
    });

    it('responde 404 sem expor se a Obra inexiste, é privada ou adulta', async () => {
        mockFindFirst.mockResolvedValue(null);
        const res = response();

        await getPublicWorkDetails({ params: { slug: 'segredo' } }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Obra não encontrada.' });
    });

    it('deriva a capa de cada Edição do Volume 1 público da própria Edição', async () => {
        const work = workFixture();
        work.editions.push({ ...work.editions[0], id: 11, chronologicalNumber: 2 });
        mockFindFirst.mockResolvedValue(work);
        // Só a Edição 11 tem Volume 1 público; a Edição 10 não pode herdar essa capa.
        mockVolumeFindMany.mockResolvedValue([{ editionId: 11, coverAsset: cover('volume-1-edicao-11') }]);
        const res = response();

        await getPublicWorkDetails({ params: { slug: 'lobo-solitario' } }, res, jest.fn());

        expect(mockVolumeFindMany).toHaveBeenCalledWith({
            where: { editionId: { in: [10, 11] }, number: 1, visibility: 'Público' },
            select: publicEditionCoverSourceVolumeSelect
        });
        const { editions } = res.json.mock.calls[0][0].work;
        expect(editions.find((edition) => edition.id === 10).coverUrl).toBeNull();
        expect(editions.find((edition) => edition.id === 11).coverUrl)
            .toBe('https://media.comanga.test/covers/volume-1-edicao-11/large.webp');
    });

    it('não consulta o Volume 1 quando a Obra não possui Edições públicas', async () => {
        mockFindFirst.mockResolvedValue({ ...workFixture(), editions: [] });
        const res = response();

        await getPublicWorkDetails({ params: { slug: 'lobo-solitario' } }, res, jest.fn());

        expect(mockVolumeFindMany).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('limita a seleção a Edições e Volumes públicos', () => {
        expect(publicWorkDetailSelect.editions.select).not.toHaveProperty('coverAsset');
        expect(publicWorkDetailSelect.editions.where).toEqual({ visibility: 'Público' });
        expect(publicWorkDetailSelect.editions.orderBy).toEqual([
            { chronologicalNumber: 'asc' },
            { id: 'asc' }
        ]);
        expect(publicWorkDetailSelect.editions.select.volumes.where).toEqual({ visibility: 'Público' });
        expect(publicWorkDetailSelect.editions.select.volumes.take).toBe(3);
        expect(publicWorkDetailSelect.editions.select.volumes.select).not.toHaveProperty('synopsis');
        expect(publicWorkDetailSelect.editions.select._count.select.volumes.where)
            .toEqual({ visibility: 'Público' });
    });

    it('encaminha falha inesperada ao middleware de erro', async () => {
        const error = new Error('database unavailable');
        mockFindFirst.mockRejectedValue(error);
        const next = jest.fn();

        await getPublicWorkDetails({ params: { slug: 'lobo-solitario' } }, response(), next);

        expect(next).toHaveBeenCalledWith(error);
    });
});
