const mockVolumeFindFirst = jest.fn();

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: {
        volume: { findFirst: mockVolumeFindFirst }
    }
}));

const { getPublicVolumeDetails } = require('../src/modules/public-catalog');
const { publicVolumeDetailSelect } = require('../src/modules/public-catalog/queries');

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

function volumeFixture(overrides = {}) {
    return {
        id: 30,
        number: 1,
        singleVolume: false,
        coverAsset: cover('volume'),
        pages: 416,
        price: '79.90',
        priceCurrency: 'R$',
        releaseDatePrecision: 'Completa',
        releaseYear: 2026,
        releaseMonth: 8,
        releaseDay: 20,
        isbn10: '1234567890',
        isbn13: '9781234567890',
        affiliateLink: 'https://shop.example/volume-1',
        synopsis: 'Uma sinopse pública.',
        edition: {
            id: 20,
            chronologicalNumber: 2,
            work: {
                id: 8,
                slug: 'monster',
                title: 'Monster',
                originalTitle: 'MONSTER'
            }
        },
        ...overrides
    };
}

describe('detalhes públicos do Volume', () => {
    const previousMediaUrl = process.env.MEDIA_PUBLIC_BASE_URL;

    beforeAll(() => {
        process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.comanga.test';
    });

    afterAll(() => {
        if (previousMediaUrl === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
        else process.env.MEDIA_PUBLIC_BASE_URL = previousMediaUrl;
    });

    beforeEach(() => jest.clearAllMocks());

    it('retorna todos os dados públicos e as referências da hierarquia', async () => {
        mockVolumeFindFirst.mockResolvedValue(volumeFixture());
        const res = response();

        await getPublicVolumeDetails({
            params: { volumeId: '30' },
            publicCatalogViewer: { canViewAdultContent: false }
        }, res, jest.fn());

        expect(mockVolumeFindFirst).toHaveBeenCalledWith({
            where: {
                id: 30,
                visibility: 'Público',
                edition: {
                    visibility: 'Público',
                    work: { visibility: 'Público', adultContent: false }
                }
            },
            select: publicVolumeDetailSelect
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            volume: {
                id: 30,
                number: 1,
                singleVolume: false,
                coverUrl: 'https://media.comanga.test/covers/volume/large.webp',
                pages: 416,
                price: 79.9,
                priceCurrency: 'R$',
                releaseDatePrecision: 'Completa',
                releaseYear: 2026,
                releaseMonth: 8,
                releaseDay: 20,
                isbn10: '1234567890',
                isbn13: '9781234567890',
                affiliateLink: 'https://shop.example/volume-1',
                synopsis: 'Uma sinopse pública.',
                edition: {
                    id: 20,
                    chronologicalNumber: 2,
                    work: {
                        id: 8,
                        slug: 'monster',
                        title: 'Monster',
                        originalTitle: 'MONSTER'
                    }
                }
            }
        });
        expect(res.vary).toHaveBeenCalledWith('Cookie');
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it('mantém toda a hierarquia pública ao liberar conteúdo adulto elegível', async () => {
        mockVolumeFindFirst.mockResolvedValue(volumeFixture());

        await getPublicVolumeDetails({
            params: { volumeId: '30' },
            publicCatalogViewer: { canViewAdultContent: true }
        }, response(), jest.fn());

        expect(mockVolumeFindFirst.mock.calls[0][0].where).toEqual({
            id: 30,
            visibility: 'Público',
            edition: {
                visibility: 'Público',
                work: { visibility: 'Público' }
            }
        });
    });

    it.each(['abc', '0', '-1'])('rejeita ID inválido %s antes de consultar o banco', async (volumeId) => {
        const res = response();

        await getPublicVolumeDetails({ params: { volumeId } }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Parâmetros de consulta inválidos.' });
        expect(mockVolumeFindFirst).not.toHaveBeenCalled();
    });

    it('responde 404 sem expor qual nível da hierarquia é restrito', async () => {
        mockVolumeFindFirst.mockResolvedValue(null);
        const res = response();

        await getPublicVolumeDetails({ params: { volumeId: '30' } }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Volume não encontrado.' });
    });

    it('preserva campos opcionais ausentes sem inventar valores', async () => {
        mockVolumeFindFirst.mockResolvedValue(volumeFixture({
            coverAsset: null,
            pages: null,
            price: null,
            releaseDatePrecision: 'Desconhecida',
            releaseYear: null,
            releaseMonth: null,
            releaseDay: null,
            isbn10: null,
            isbn13: null,
            affiliateLink: null,
            synopsis: null
        }));
        const res = response();

        await getPublicVolumeDetails({ params: { volumeId: '30' } }, res, jest.fn());

        expect(res.json.mock.calls[0][0].volume).toEqual(expect.objectContaining({
            coverUrl: null,
            pages: null,
            price: null,
            releaseYear: null,
            isbn10: null,
            affiliateLink: null,
            synopsis: null
        }));
    });

    it('projeta somente os campos públicos previstos', () => {
        expect(publicVolumeDetailSelect).toEqual({
            id: true,
            number: true,
            singleVolume: true,
            coverAsset: expect.any(Object),
            pages: true,
            price: true,
            priceCurrency: true,
            releaseDatePrecision: true,
            releaseYear: true,
            releaseMonth: true,
            releaseDay: true,
            isbn10: true,
            isbn13: true,
            affiliateLink: true,
            synopsis: true,
            edition: expect.any(Object)
        });
    });

    it('encaminha falha inesperada ao middleware de erro', async () => {
        const error = new Error('database unavailable');
        mockVolumeFindFirst.mockRejectedValue(error);
        const next = jest.fn();

        await getPublicVolumeDetails({ params: { volumeId: '30' } }, response(), next);

        expect(next).toHaveBeenCalledWith(error);
    });
});
