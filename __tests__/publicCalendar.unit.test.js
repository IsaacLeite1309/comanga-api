const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: {
        volume: { findMany: mockFindMany, count: mockCount },
        $transaction: mockTransaction
    }
}));

const { listPublicCalendar } = require('../src/modules/public-catalog');
const { publicCalendarQuerySchema } = require('../src/modules/public-catalog/schemas');
const { buildPublicCalendarWhere, publicCalendarOrderBy } = require('../src/modules/public-catalog/queries');

function response() {
    const res = {
        status: jest.fn(() => res), json: jest.fn(() => res),
        vary: jest.fn(() => res), set: jest.fn(() => res)
    };
    return res;
}

function fixture() {
    return {
        id: 30, number: 0, singleVolume: false, coverAsset: null,
        releaseDatePrecision: 'Mes e ano', releaseYear: 2026, releaseMonth: 10, releaseDay: null,
        edition: {
            id: 20, chronologicalNumber: 2,
            brazilianPublisher: { id: 4, label: 'Panini' },
            work: { id: 8, slug: 'monster', title: 'Monster', originalTitle: 'MONSTER' }
        }
    };
}

describe('calendário público', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFindMany.mockResolvedValue([]);
        mockCount.mockResolvedValue(0);
        mockTransaction.mockImplementation((queries) => Promise.all(queries));
    });

    afterEach(() => jest.useRealTimers());

    it('resolve mês e ano no servidor a cada requisição e preserva respostas vazias', async () => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 11, 31, 23, 59));
        const december = response();
        await listPublicCalendar({ query: {} }, december, jest.fn());
        expect(december.json).toHaveBeenCalledWith({
            year: 2026, month: 12, volumes: [],
            pagination: { page: 1, limit: 12, total: 0, totalPages: 0 }
        });
        jest.setSystemTime(new Date(2027, 0, 1));
        const january = response();
        await listPublicCalendar({ query: {} }, january, jest.fn());
        expect(january.json.mock.calls[0][0]).toMatchObject({ year: 2027, month: 1 });
        expect(january.vary).toHaveBeenCalledWith('Cookie');
        expect(january.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it.each([
        [{ year: '2020' }, { year: 2020, month: 10 }],
        [{ month: '2' }, { year: 2026, month: 2 }]
    ])('resolve apenas o componente de período omitido', async (query, expected) => {
        jest.useFakeTimers().setSystemTime(new Date(2026, 9, 15));
        const res = response();
        await listPublicCalendar({ query }, res, jest.fn());
        expect(res.json.mock.calls[0][0]).toMatchObject(expected);
    });

    it('combina período, editora e identidade sem remover visibilidade ou restrição adulta', () => {
        const query = publicCalendarQuerySchema.parse({ year: '2026', month: '10', term: ' Urasawa ', brazilianPublisherId: '4' });
        const where = buildPublicCalendarWhere(query, false);
        expect(where).toEqual({
            visibility: 'Público', releaseYear: 2026, releaseMonth: 10,
            releaseDatePrecision: { in: ['Completa', 'Mes e ano'] },
            edition: {
                visibility: 'Público', brazilianPublisherId: 4,
                work: {
                    visibility: 'Público', adultContent: false,
                    genres: { none: { genre: {
                        OR: [{ code: 'hentai' }, { adultOnly: true }], category: { slug: 'generos' }
                    } } },
                    OR: [
                        { title: { contains: 'Urasawa', mode: 'insensitive' } },
                        { originalTitle: { contains: 'Urasawa', mode: 'insensitive' } },
                        { romanizedTitle: { contains: 'Urasawa', mode: 'insensitive' } },
                        { authors: { some: { author: { label: { contains: 'Urasawa', mode: 'insensitive' } } } } }
                    ]
                }
            }
        });
        expect(buildPublicCalendarWhere(query, true).edition.work).toEqual({ visibility: 'Público', OR: where.edition.work.OR });
    });

    it('pagina em ordem alfabética com desempate estável e preserva data parcial e número zero', async () => {
        mockFindMany.mockResolvedValue([fixture()]);
        mockCount.mockResolvedValue(25);
        const res = response();
        await listPublicCalendar({ query: { year: '2026', month: '10', page: '2' } }, res, jest.fn());
        expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
            skip: 12, take: 12,
            orderBy: [
                { edition: { work: { title: 'asc' } } },
                { edition: { chronologicalNumber: 'asc' } },
                { number: 'asc' },
                { id: 'asc' }
            ]
        }));
        expect(mockFindMany.mock.calls[0][0].where).toEqual(mockCount.mock.calls[0][0].where);
        const volume = fixture();
        delete volume.coverAsset;
        expect(res.json).toHaveBeenCalledWith({
            year: 2026, month: 10, volumes: [{ ...volume, coverUrl: null }],
            pagination: { page: 2, limit: 12, total: 25, totalPages: 3 }
        });
    });

    it('inverte título e desempates para Z-A antes de paginar', async () => {
        await listPublicCalendar({ query: { year: '2026', month: '10', order: 'DESC', page: '2' } }, response(), jest.fn());
        expect(mockFindMany.mock.calls[0][0]).toMatchObject({
            skip: 12,
            orderBy: publicCalendarOrderBy('DESC')
        });
        expect(mockFindMany.mock.calls[0][0].orderBy[0]).toEqual({ edition: { work: { title: 'desc' } } });
    });

    it.each([
        ['month', '0'], ['month', '13'], ['month', '1.5'], ['month', 'abc'],
        ['year', '1899'], ['year', '2201'], ['year', ''], ['year', null],
        ['year', ['2026']], ['month', { value: 10 }], ['month', true],
        ['brazilianPublisherId', '0'], ['brazilianPublisherId', '2147483648'],
        ['page', '0'], ['page', '2147483647'], ['limit', '51'], ['limit', '-1'],
        ['term', ['x', 'y']], ['term', 'x'.repeat(256)], ['order', 'INVALID']
    ])('rejeita %s inválido sem consultar o banco (%j)', async (key, value) => {
        const res = response();
        await listPublicCalendar({ query: { [key]: value } }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Filtros de consulta inválidos.' });
        expect(mockFindMany).not.toHaveBeenCalled();
    });

    it.each([{ canViewAdultContent: true }, { hasAdminAssignment: true }])('aplica a autorização adulta vigente à sessão %j', async (publicCatalogViewer) => {
        await listPublicCalendar({ query: {}, publicCatalogViewer }, response(), jest.fn());
        expect(mockFindMany.mock.calls[0][0].where.edition.work).toEqual({ visibility: 'Público' });
    });

    it('encaminha falhas da consulta ao tratamento centralizado', async () => {
        const failure = new Error('database unavailable');
        mockTransaction.mockRejectedValue(failure);
        const next = jest.fn();
        await listPublicCalendar({ query: {} }, response(), next);
        expect(next).toHaveBeenCalledWith(failure);
    });
});
