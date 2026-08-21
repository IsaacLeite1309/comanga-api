const mockFindFirst = jest.fn();

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: {
        work: { findFirst: mockFindFirst }
    }
}));

const { getPublicWorkDetails } = require('../src/modules/public-catalog');
const { publicWorkDetailSelect } = require('../src/modules/public-catalog/queries');

function response() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        vary: jest.fn(() => res),
        set: jest.fn(() => res)
    };
    return res;
}

function workFixture() {
    const cover = (id) => ({
        objectKey: `covers/${id}/master.webp`,
        variants: [{ kind: 'COVER_LARGE', objectKey: `covers/${id}/large.webp` }]
    });
    return {
        id: 8,
        slug: 'lobo-solitario',
        title: 'Lobo Solitário',
        originalTitle: 'Kozure Ōkami',
        originalPublicationStartYear: 1970,
        originalPublicationEndYear: 1976,
        originalVolumeCount: 28,
        directRelease: false,
        country: 'Japão',
        originalPublicationStatus: 'Finalizada',
        coverAsset: cover('work'),
        type: { id: 1, label: 'Mangá' },
        authors: [{
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
            coverAsset: cover('edition'),
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

describe('detalhes públicos da Obra', () => {
    const previousMediaUrl = process.env.MEDIA_PUBLIC_BASE_URL;

    beforeAll(() => {
        process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.comanga.test';
    });

    afterAll(() => {
        if (previousMediaUrl === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
        else process.env.MEDIA_PUBLIC_BASE_URL = previousMediaUrl;
    });

    beforeEach(() => jest.clearAllMocks());

    it('projeta ficha completa, Edições públicas e amostra limitada de Volumes públicos', async () => {
        mockFindFirst.mockResolvedValue(workFixture());
        const res = response();

        await getPublicWorkDetails({
            params: { slug: 'lobo-solitario' },
            publicCatalogViewer: { canViewAdultContent: false }
        }, res, jest.fn());

        expect(mockFindFirst).toHaveBeenCalledWith({
            where: {
                slug: 'lobo-solitario',
                visibility: 'Público',
                adultContent: false
            },
            select: publicWorkDetailSelect
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            work: expect.objectContaining({
                slug: 'lobo-solitario',
                coverUrl: 'https://media.comanga.test/covers/work/large.webp',
                authors: [{ id: 2, label: 'Kazuo Koike', roles: ['Roteiro'] }],
                genres: [{ id: 3, label: 'Drama' }],
                demographics: ['Seinen'],
                editions: [expect.objectContaining({
                    id: 10,
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

    it('responde 404 sem expor se a Obra inexiste, é privada ou adulta', async () => {
        mockFindFirst.mockResolvedValue(null);
        const res = response();

        await getPublicWorkDetails({ params: { slug: 'segredo' } }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Obra não encontrada.' });
    });

    it('limita a seleção a Edições e Volumes públicos', () => {
        expect(publicWorkDetailSelect.editions.where).toEqual({ visibility: 'Público' });
        expect(publicWorkDetailSelect.editions.orderBy).toEqual([
            { chronologicalNumber: 'asc' },
            { id: 'asc' }
        ]);
        expect(publicWorkDetailSelect.editions.select.volumes.where).toEqual({ visibility: 'Público' });
        expect(publicWorkDetailSelect.editions.select.volumes.take).toBe(3);
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
