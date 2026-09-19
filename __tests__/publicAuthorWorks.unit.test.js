const mockOptionFindFirst = jest.fn();
const mockWorkFindMany = jest.fn();
const mockWorkCount = jest.fn();
const mockTransaction = jest.fn(async (operations) => Promise.all(operations));

jest.mock('../src/prisma', () => ({
    __esModule: true,
    default: {
        domainOptionValue: { findFirst: mockOptionFindFirst },
        work: {
            findMany: mockWorkFindMany,
            count: mockWorkCount
        },
        $transaction: mockTransaction
    }
}));

const { listPublicAuthorWorks } = require('../src/modules/public-catalog');
const { publicWorkSelect } = require('../src/modules/public-catalog/queries');

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
    return {
        id: 8,
        slug: 'monster',
        title: 'Monster',
        originalTitle: 'MONSTER',
        coverAsset: null,
        country: 'Japão',
        type: { id: 2, label: 'Mangá' },
        authors: [{ author: { id: 5, label: 'Naoki Urasawa' } }]
    };
}

describe('Obras públicas por Autor', () => {
    beforeEach(() => jest.clearAllMocks());

    it('retorna o Autor e somente suas Obras públicas paginadas', async () => {
        mockOptionFindFirst.mockResolvedValue({ id: 5, label: 'Naoki Urasawa' });
        mockWorkFindMany.mockResolvedValue([workFixture()]);
        mockWorkCount.mockResolvedValue(13);
        const res = response();

        await listPublicAuthorWorks({
            params: { authorId: '5' },
            query: { page: '2', limit: '12', sortBy: 'title', order: 'ASC' },
            publicCatalogViewer: { canViewAdultContent: false }
        }, res, jest.fn());

        expect(mockOptionFindFirst).toHaveBeenCalledWith({
            where: { id: 5, category: { slug: 'autores' } },
            select: { id: true, label: true }
        });
        const where = {
            visibility: 'Público',
            adultContent: false,
            authors: { some: { authorId: 5 } }
        };
        expect(mockWorkFindMany).toHaveBeenCalledWith({
            where,
            select: publicWorkSelect,
            orderBy: [{ title: 'asc' }, { id: 'asc' }],
            skip: 12,
            take: 12
        });
        expect(mockWorkCount).toHaveBeenCalledWith({ where });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            author: { id: 5, label: 'Naoki Urasawa' },
            works: [expect.objectContaining({ id: 8, slug: 'monster', title: 'Monster' })],
            pagination: { page: 2, limit: 12, total: 13, totalPages: 2 }
        });
        expect(res.vary).toHaveBeenCalledWith('Cookie');
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it('mantém visibilidade pública e libera +18 somente para sessão elegível', async () => {
        mockOptionFindFirst.mockResolvedValue({ id: 5, label: 'Naoki Urasawa' });
        mockWorkFindMany.mockResolvedValue([]);
        mockWorkCount.mockResolvedValue(0);

        await listPublicAuthorWorks({
            params: { authorId: '5' },
            query: {},
            publicCatalogViewer: { canViewAdultContent: true }
        }, response(), jest.fn());

        expect(mockWorkFindMany.mock.calls[0][0].where).toEqual({
            visibility: 'Público',
            authors: { some: { authorId: 5 } }
        });
    });

    it.each([
        [{ authorId: 'abc' }, {}, 'ID inválido'],
        [{ authorId: '5' }, { page: '0' }, 'página inválida'],
        [{ authorId: '5' }, { limit: '51' }, 'limite inválido'],
        [{ authorId: '5' }, { sortBy: 'unknown' }, 'ordenação inválida']
    ])('rejeita %s antes de consultar o banco', async (params, query) => {
        const res = response();

        await listPublicAuthorWorks({ params, query }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Parâmetros de consulta inválidos.' });
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('não aceita ID inexistente ou pertencente a outra categoria', async () => {
        mockOptionFindFirst.mockResolvedValue(null);
        mockWorkFindMany.mockResolvedValue([]);
        mockWorkCount.mockResolvedValue(0);
        const res = response();

        await listPublicAuthorWorks({
            params: { authorId: '5' },
            query: {}
        }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Autor não encontrado.' });
    });

    it('encaminha falha inesperada ao middleware de erro', async () => {
        const error = new Error('database unavailable');
        mockOptionFindFirst.mockRejectedValue(error);
        mockWorkFindMany.mockResolvedValue([]);
        mockWorkCount.mockResolvedValue(0);
        const next = jest.fn();

        await listPublicAuthorWorks({
            params: { authorId: '5' },
            query: {}
        }, response(), next);

        expect(next).toHaveBeenCalledWith(error);
    });
});
