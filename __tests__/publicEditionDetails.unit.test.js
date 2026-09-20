const mockEditionFindFirst = jest.fn();
const mockVolumeFindMany = jest.fn();
const mockVolumeFindFirst = jest.fn();
const mockTransaction = jest.fn(async (operations) => Promise.all(operations));

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: {
        edition: { findFirst: mockEditionFindFirst },
        volume: { findMany: mockVolumeFindMany, findFirst: mockVolumeFindFirst },
        $transaction: mockTransaction
    }
}));

const { getPublicEditionDetails } = require('../src/modules/public-catalog');
const {
    publicEditionDetailSelect,
    publicEditionVolumeSelect
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

function editionFixture() {
    return {
        id: 10,
        chronologicalNumber: 2,
        brazilPublicationStatus: 'Em publicação',
        // Origem única da capa: o Volume 1 público desta Edição.
        volumes: [{ coverAsset: cover('volume-1') }],
        brazilianPublisher: { id: 1, label: 'Panini' },
        editionType: { id: 2, label: 'Deluxe' },
        format: { id: 3, label: 'Kanzenban' },
        coverType: { id: 4, label: 'Capa dura' },
        work: {
            id: 8,
            slug: 'monster',
            title: 'Monster',
            originalTitle: 'MONSTER',
            originalPublicationStatus: 'Em andamento',
            authors: [{ author: { id: 5, label: 'Naoki Urasawa' } }]
        },
        _count: { volumes: 26 }
    };
}

function volumeFixture() {
    return {
        id: 20,
        number: 2,
        singleVolume: false,
        pages: 416,
        releaseDatePrecision: 'Completa',
        releaseYear: 2026,
        releaseMonth: 8,
        releaseDay: 20,
        coverAsset: cover('volume')
    };
}

const HENTAI_RESTRICTION = { genres: { none: { genre: { code: 'hentai', category: { slug: 'generos' } } } } };

describe('detalhes públicos da Edição', () => {
    const previousMediaUrl = process.env.MEDIA_PUBLIC_BASE_URL;

    beforeAll(() => {
        process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.comanga.test';
    });

    afterAll(() => {
        if (previousMediaUrl === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
        else process.env.MEDIA_PUBLIC_BASE_URL = previousMediaUrl;
    });

    beforeEach(() => jest.clearAllMocks());

    it('retorna ficha editorial e Volumes públicos paginados em ordem crescente', async () => {
        mockEditionFindFirst.mockResolvedValue(editionFixture());
        mockVolumeFindMany.mockResolvedValue([volumeFixture()]);
        mockVolumeFindFirst
            .mockResolvedValueOnce({ releaseYear: 2026 })
            .mockResolvedValueOnce({ releaseYear: 2028 });
        const res = response();

        await getPublicEditionDetails({
            params: { editionId: '10' },
            query: { page: '2', limit: '12' },
            publicCatalogViewer: { canViewAdultContent: false }
        }, res, jest.fn());

        const hierarchy = {
            id: 10,
            visibility: 'Público',
            work: { visibility: 'Público', adultContent: false, ...HENTAI_RESTRICTION }
        };
        expect(mockEditionFindFirst).toHaveBeenCalledWith({
            where: hierarchy,
            select: publicEditionDetailSelect
        });
        expect(mockVolumeFindMany).toHaveBeenCalledWith({
            where: {
                visibility: 'Público',
                edition: hierarchy
            },
            select: publicEditionVolumeSelect,
            orderBy: [{ number: 'asc' }, { id: 'asc' }],
            skip: 12,
            take: 12
        });
        expect(mockVolumeFindFirst).toHaveBeenNthCalledWith(1, {
            where: {
                visibility: 'Público',
                edition: hierarchy
            },
            select: { releaseYear: true },
            orderBy: [{ number: 'asc' }, { id: 'asc' }]
        });
        expect(mockVolumeFindFirst).toHaveBeenNthCalledWith(2, {
            where: {
                visibility: 'Público',
                edition: hierarchy
            },
            select: { releaseYear: true },
            orderBy: [{ number: 'desc' }, { id: 'desc' }]
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            edition: expect.objectContaining({
                id: 10,
                chronologicalNumber: 2,
                coverUrl: 'https://media.comanga.test/covers/volume-1/large.webp',
                brazilPublicationStartYear: 2026,
                brazilPublicationEndYear: null,
                volumesCount: 26,
                work: expect.objectContaining({
                    slug: 'monster',
                    authors: [{ id: 5, label: 'Naoki Urasawa' }]
                })
            }),
            volumes: [expect.objectContaining({
                id: 20,
                number: 2,
                pages: 416,
                coverUrl: 'https://media.comanga.test/covers/volume/large.webp'
            })],
            pagination: { page: 2, limit: 12, total: 26, totalPages: 3 }
        });
        expect(res.vary).toHaveBeenCalledWith('Cookie');
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it('mantém a hierarquia pública e só omite a restrição adulta para sessão elegível', async () => {
        mockEditionFindFirst.mockResolvedValue(editionFixture());
        mockVolumeFindMany.mockResolvedValue([]);

        await getPublicEditionDetails({
            params: { editionId: '10' },
            query: {},
            publicCatalogViewer: { canViewAdultContent: true }
        }, response(), jest.fn());

        expect(mockEditionFindFirst.mock.calls[0][0].where).toEqual({
            id: 10,
            visibility: 'Público',
            work: { visibility: 'Público' }
        });
    });

    it.each([
        [{ editionId: 'abc' }, {}, 'id inválido'],
        [{ editionId: '10' }, { page: '0' }, 'página inválida'],
        [{ editionId: '10' }, { limit: '51' }, 'limite inválido']
    ])('rejeita %s antes de consultar o banco', async (params, query) => {
        const res = response();

        await getPublicEditionDetails({ params, query }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Parâmetros de consulta inválidos.' });
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('responde 404 sem expor se a Edição ou a Obra é restrita', async () => {
        mockEditionFindFirst.mockResolvedValue(null);
        mockVolumeFindMany.mockResolvedValue([]);
        const res = response();

        await getPublicEditionDetails({
            params: { editionId: '10' },
            query: {}
        }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Edição não encontrada.' });
    });

    it('representa capa ausente quando a Edição pública não tem Volume 1 público', async () => {
        mockEditionFindFirst.mockResolvedValue({ ...editionFixture(), volumes: [] });
        mockVolumeFindMany.mockResolvedValue([]);
        const res = response();

        await getPublicEditionDetails({ params: { editionId: '10' }, query: {} }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            edition: expect.objectContaining({ coverUrl: null })
        }));
    });

    it('deriva a capa somente do Volume 1 público da própria Edição', () => {
        expect(publicEditionDetailSelect).not.toHaveProperty('coverAsset');
        expect(publicEditionDetailSelect.volumes).toEqual(expect.objectContaining({
            where: { number: 1, visibility: 'Público' },
            take: 1
        }));
    });

    it('projeta apenas o resumo público necessário de cada Volume', () => {
        expect(publicEditionVolumeSelect).toEqual(expect.objectContaining({
            id: true,
            number: true,
            singleVolume: true,
            pages: true,
            releaseDatePrecision: true,
            releaseYear: true,
            releaseMonth: true,
            releaseDay: true
        }));
        expect(publicEditionDetailSelect._count.select.volumes.where)
            .toEqual({ visibility: 'Público' });
    });

    it('encaminha falha inesperada ao middleware de erro', async () => {
        const error = new Error('database unavailable');
        mockEditionFindFirst.mockRejectedValue(error);
        mockVolumeFindMany.mockResolvedValue([]);
        const next = jest.fn();

        await getPublicEditionDetails({
            params: { editionId: '10' },
            query: {}
        }, response(), next);

        expect(next).toHaveBeenCalledWith(error);
    });
});
