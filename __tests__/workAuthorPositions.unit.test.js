const prisma = {
    domainOptionValue: {
        findMany: jest.fn(),
        count: jest.fn()
    },
    workAuthor: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workAuthorRole: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workGenre: { createMany: jest.fn(), deleteMany: jest.fn(), findFirst: jest.fn() },
    workDemography: { createMany: jest.fn(), deleteMany: jest.fn() },
    workSerializationMagazine: { createMany: jest.fn(), deleteMany: jest.fn() },
    workOriginalPublisher: { createMany: jest.fn(), deleteMany: jest.fn() },
    work: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn()
    },
    mediaAsset: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn()
};

jest.mock('../src/prisma', () => prisma);

const catalog = require('../src/modules/catalog');

const COVER_ASSET_ID = '7f28c7f0-c94f-46e8-b61c-6ea716f8f28e';

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };
    return res;
}

function makeReq(overrides = {}) {
    return {
        query: {},
        params: {},
        body: {},
        user: { userId: 'admin-1', role: 'Administrador' },
        ...overrides
    };
}

function persistedWork(authors) {
    return {
        id: 1,
        slug: 'obra',
        title: 'Obra',
        originalTitle: null,
        romanizedTitle: 'Obra',
        synopsis: 'Sinopse própria da Obra.',
        originalPublicationStartYear: null,
        originalPublicationEndYear: null,
        directRelease: true,
        visibility: 'Privado',
        adultContent: false,
        coverAssetId: COVER_ASSET_ID,
        coverAsset: null,
        type: { id: 1, label: 'Mangá' },
        country: 'Japão',
        originalPublicationStatus: 'Completa',
        originalPublishers: [],
        genres: [],
        demographics: [],
        serializationMagazines: [],
        authors
    };
}

function createBody(authors) {
    return {
        title: 'Obra',
        romanizedTitle: 'Obra',
        synopsis: 'Sinopse própria da Obra.',
        typeId: 1,
        country: 'Japão',
        coverAssetId: COVER_ASSET_ID,
        originalPublicationStatus: 'Completa',
        directRelease: true,
        authors
    };
}

describe('ordem editorial dos Autores nos endpoints administrativos', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        prisma.mediaAsset.findUnique.mockResolvedValue({
            id: COVER_ASSET_ID,
            status: 'Pendente',
            work: null,
            edition: null,
            volume: null
        });
        prisma.$transaction.mockImplementation(async (operation) => (
            typeof operation === 'function' ? operation(prisma) : Promise.all(operation)
        ));
        prisma.domainOptionValue.count.mockImplementation(({ where }) => (
            Promise.resolve(where.id?.in?.length || 1)
        ));
        prisma.domainOptionValue.findMany.mockResolvedValue([]);
        prisma.work.findFirst.mockResolvedValue(null);
        prisma.work.create.mockResolvedValue({ id: 1 });
    });

    it('exibe os autores em ordem canônica de crédito no cadastro', async () => {
        prisma.work.findUniqueOrThrow.mockResolvedValue(persistedWork([
            { position: 0, author: { id: 11, label: 'Osamu Tezuka' }, roles: [{ role: 'Ilustrador' }] },
            { position: 1, author: { id: 4, label: 'Masashi Kishimoto' }, roles: [{ role: 'História e Arte' }] }
        ]));
        const res = makeRes();

        await catalog.createWork(makeReq({
            body: createBody([
                { authorId: 11, roles: ['Ilustrador'] },
                { authorId: 4, roles: ['História e Arte'] }
            ])
        }), res, jest.fn());

        expect(prisma.work.create.mock.calls[0][0].data.authors).toEqual({
            createMany: {
                data: [
                    { authorId: 11, position: 0 },
                    { authorId: 4, position: 1 }
                ]
            }
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json.mock.calls[0][0].work.authors.map((item) => item.author.id)).toEqual([4, 11]);
    });

    it('normaliza posições manipuladas e duplicadas do payload em vez de recusar', async () => {
        prisma.work.findUniqueOrThrow.mockResolvedValue(persistedWork([]));
        const manipulated = makeRes();
        const duplicated = makeRes();

        await catalog.createWork(makeReq({
            body: createBody([
                { authorId: 4, roles: ['História'], position: 9 },
                { authorId: 11, roles: ['Arte'], position: 3 }
            ])
        }), manipulated, jest.fn());
        await catalog.createWork(makeReq({
            body: createBody([
                { authorId: 4, roles: ['História'], position: 0 },
                { authorId: 11, roles: ['Arte'], position: 0 }
            ])
        }), duplicated, jest.fn());

        expect(manipulated.status).toHaveBeenCalledWith(201);
        expect(prisma.work.create.mock.calls[0][0].data.authors.createMany.data).toEqual([
            { authorId: 4, position: 0 },
            { authorId: 11, position: 1 }
        ]);
        expect(duplicated.status).toHaveBeenCalledWith(201);
        expect(prisma.work.create.mock.calls[1][0].data.authors.createMany.data).toEqual([
            { authorId: 4, position: 0 },
            { authorId: 11, position: 1 }
        ]);
    });

    it('reordena autores na alteração preservando todos os papéis associados', async () => {
        prisma.work.findUnique
            .mockResolvedValueOnce({
                id: 1,
                coverAssetId: COVER_ASSET_ID,
                country: 'Japão',
                typeId: 1,
                authors: [{ authorId: 4 }, { authorId: 11 }],
                originalPublishers: [],
                serializationMagazines: []
            })
            .mockResolvedValueOnce(persistedWork([
                { position: 0, author: { id: 11, label: 'Osamu Tezuka' }, roles: [{ role: 'Criador Original' }, { role: 'Ilustrador' }] },
                { position: 1, author: { id: 4, label: 'Masashi Kishimoto' }, roles: [{ role: 'História e Arte' }] }
            ]));
        const res = makeRes();

        await catalog.updateWork(makeReq({
            params: { id: '1' },
            body: {
                authors: [
                    { authorId: 11, roles: ['Criador Original', 'Ilustrador'] },
                    { authorId: 4, roles: ['História e Arte'] }
                ]
            }
        }), res, jest.fn());

        expect(prisma.workAuthor.createMany).toHaveBeenCalledWith({
            data: [
                { workId: 1, authorId: 11, position: 0 },
                { workId: 1, authorId: 4, position: 1 }
            ]
        });
        expect(prisma.workAuthorRole.createMany).toHaveBeenCalledWith({
            data: [
                { workId: 1, authorId: 11, role: 'Criador Original' },
                { workId: 1, authorId: 11, role: 'Ilustrador' },
                { workId: 1, authorId: 4, role: 'História e Arte' }
            ]
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0].work.authors).toEqual([
            { author: { id: 11, label: 'Osamu Tezuka' }, roles: ['Criador Original', 'Ilustrador'] },
            { author: { id: 4, label: 'Masashi Kishimoto' }, roles: ['História e Arte'] }
        ]);
    });

    it('renumera de 0 a n-1 ao remover um autor do meio da lista', async () => {
        prisma.work.findUnique
            .mockResolvedValueOnce({
                id: 1,
                coverAssetId: COVER_ASSET_ID,
                country: 'Japão',
                typeId: 1,
                authors: [{ authorId: 4 }, { authorId: 7 }, { authorId: 11 }],
                originalPublishers: [],
                serializationMagazines: []
            })
            .mockResolvedValueOnce(persistedWork([]));
        const res = makeRes();

        await catalog.updateWork(makeReq({
            params: { id: '1' },
            body: {
                authors: [
                    { authorId: 4, roles: ['História'], position: 0 },
                    { authorId: 11, roles: ['Arte'], position: 2 }
                ]
            }
        }), res, jest.fn());

        expect(prisma.workAuthor.deleteMany).toHaveBeenCalledWith({ where: { workId: 1 } });
        expect(prisma.workAuthor.createMany).toHaveBeenCalledWith({
            data: [
                { workId: 1, authorId: 4, position: 0 },
                { workId: 1, authorId: 11, position: 1 }
            ]
        });
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('grava autores, papéis e posições na mesma transação da alteração', async () => {
        prisma.work.findUnique
            .mockResolvedValueOnce({
                id: 1,
                coverAssetId: COVER_ASSET_ID,
                country: 'Japão',
                typeId: 1,
                authors: [{ authorId: 4 }],
                originalPublishers: [],
                serializationMagazines: []
            })
            .mockResolvedValueOnce(persistedWork([]));
        prisma.workAuthor.createMany.mockReturnValue('createAuthorsOperation');
        prisma.workAuthorRole.createMany.mockReturnValue('createRolesOperation');

        await catalog.updateWork(makeReq({
            params: { id: '1' },
            body: { authors: [{ authorId: 4, roles: ['História'] }] }
        }), makeRes(), jest.fn());

        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
        expect(prisma.workAuthor.createMany).toHaveBeenCalledWith({
            data: [{ workId: 1, authorId: 4, position: 0 }]
        });
        expect(prisma.workAuthorRole.createMany).toHaveBeenCalledWith({
            data: [{ workId: 1, authorId: 4, role: 'História' }]
        });
    });
});
