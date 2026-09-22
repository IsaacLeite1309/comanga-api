const prisma = {
    domainOptionCategory: {
        findUnique: jest.fn()
    },
    domainOptionValue: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn()
};

jest.mock('../src/prisma', () => prisma);

const adminOptions = require('../src/modules/admin/options');
const { buildOptionValueOrderBy } = require('../src/modules/admin/options/queries');
const {
    buildAdultWorkRestriction,
    canViewAdultContent,
    isRestrictedAdultOption
} = require('../src/modules/public-catalog/adultContentPolicy');
const {
    HENTAI_GENRE_CODE,
    isOrderedOptionCategory,
    isSystemManagedOptionCategory
} = require('../src/utils/domainOptionCodes');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };

    return res;
}

function makeReq(overrides = {}) {
    return { query: {}, params: {}, body: {}, ...overrides };
}

describe('identidade estável das opções controladas', () => {
    it.each(['tipos-obra', 'generos'])('trata %s como controlada pelo sistema', (slug) => {
        expect(isSystemManagedOptionCategory(slug)).toBe(true);
    });

    it.each(['autores', 'editoras-brasileiras', 'tipos-capa'])(
        'mantém %s fora do controle do sistema',
        (slug) => {
            expect(isSystemManagedOptionCategory(slug)).toBe(false);
        }
    );

    it('reconhece apenas gêneros e tipos de Obra como ordenáveis por posição', () => {
        expect(isOrderedOptionCategory('generos')).toBe(true);
        expect(isOrderedOptionCategory('tipos-obra')).toBe(true);
        expect(isOrderedOptionCategory('autores')).toBe(false);
    });

    it('ordena por posição só onde a posição é significativa', () => {
        expect(buildOptionValueOrderBy('tipos-obra', 'asc')).toEqual([
            { position: 'asc' }, { label: 'asc' }, { id: 'asc' }
        ]);
        expect(buildOptionValueOrderBy('autores', 'desc')).toEqual([
            { label: 'desc' }, { id: 'asc' }
        ]);
    });
});

describe('política de leitura de conteúdo adulto', () => {
    it('só libera para preferência elegível ou atribuição administrativa', () => {
        expect(canViewAdultContent({})).toBe(false);
        expect(canViewAdultContent({ publicCatalogViewer: {
            canViewAdultContent: false, hasAdminAssignment: false
        } })).toBe(false);
        expect(canViewAdultContent({ publicCatalogViewer: {
            canViewAdultContent: true, hasAdminAssignment: false
        } })).toBe(true);
        expect(canViewAdultContent({ publicCatalogViewer: {
            canViewAdultContent: false, hasAdminAssignment: true
        } })).toBe(true);
    });

    it('esconde por flag adulta e por associação ao gênero de identidade estável', () => {
        expect(buildAdultWorkRestriction(false)).toEqual({
            adultContent: false,
            genres: { none: { genre: { code: HENTAI_GENRE_CODE, category: { slug: 'generos' } } } }
        });
        expect(buildAdultWorkRestriction(true)).toEqual({});
    });

    it('restringe a opção de filtro apenas pelo código, nunca pelo rótulo', () => {
        expect(isRestrictedAdultOption({ code: HENTAI_GENRE_CODE }, false)).toBe(true);
        expect(isRestrictedAdultOption({ code: HENTAI_GENRE_CODE }, true)).toBe(false);
        expect(isRestrictedAdultOption({ code: null }, false)).toBe(false);
    });
});

describe('bloqueios administrativos dos valores controlados', () => {
    beforeEach(() => jest.resetAllMocks());

    it('recusa criação em categoria controlada antes de tocar no banco', async () => {
        prisma.domainOptionCategory.findUnique.mockResolvedValue({ id: 6, slug: 'generos', name: 'Gênero' });
        const res = makeRes();

        await adminOptions.createOption(makeReq({ body: { category: 'generos', label: 'Novo' } }), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa renomear e trocar dependências de valor do sistema', async () => {
        prisma.domainOptionValue.findUnique.mockResolvedValue({
            id: 22, categoryId: 6, systemManaged: true, category: { slug: 'generos' }
        });
        const renameRes = makeRes();
        const dependencyRes = makeRes();

        await adminOptions.updateOption(makeReq({ params: { id: '22' }, body: { label: 'Outro' } }), renameRes);
        await adminOptions.updateOption(
            makeReq({ params: { id: '22' }, body: { dependsOnValueIds: [1] } }),
            dependencyRes
        );

        expect(renameRes.status).toHaveBeenCalledWith(403);
        expect(dependencyRes.status).toHaveBeenCalledWith(403);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa exclusão de valor do sistema sem chamar o delete', async () => {
        prisma.domainOptionValue.findUnique.mockResolvedValue({
            systemManaged: true, category: { slug: 'tipos-obra' }
        });
        const res = makeRes();

        await adminOptions.deleteOption(makeReq({ params: { id: '8' } }), res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(prisma.domainOptionValue.delete).not.toHaveBeenCalled();
    });

    it('exige ao menos um campo na alteração', async () => {
        const res = makeRes();

        await adminOptions.updateOption(makeReq({ params: { id: '8' }, body: {} }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Informe ao menos um campo para alterar.' });
    });

    it('permite apenas ativar ou desativar um valor do sistema', async () => {
        prisma.domainOptionValue.findUnique.mockResolvedValue({
            id: 22, categoryId: 6, systemManaged: true, category: { slug: 'generos' }
        });
        prisma.$transaction.mockImplementation(async (callback) => callback({
            domainOptionValue: {
                update: jest.fn().mockResolvedValue({
                    id: 22,
                    label: 'Hentai',
                    code: 'hentai',
                    systemManaged: true,
                    position: 10,
                    active: false,
                    category: { slug: 'generos', name: 'Gênero' }
                })
            },
            domainOptionValueDependency: { deleteMany: jest.fn(), createMany: jest.fn() }
        }));
        const res = makeRes();

        await adminOptions.updateOption(makeReq({ params: { id: '22' }, body: { active: false } }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            value: expect.objectContaining({ code: 'hentai', active: false, systemManaged: true })
        });
    });
});

describe('proteção de valores legados em categorias controladas', () => {
    it.each(['generos', 'tipos-obra'])('bloqueia renomear e excluir legado de %s', async (slug) => {
        prisma.domainOptionValue.findUnique.mockResolvedValue({
            id: 99, categoryId: 1, systemManaged: false, category: { slug }
        });
        const renamed = makeRes();
        const deleted = makeRes();
        await adminOptions.updateOption(makeReq({ params: { id: '99' }, body: { label: 'Outro' } }), renamed, jest.fn());
        await adminOptions.deleteOption(makeReq({ params: { id: '99' } }), deleted, jest.fn());
        expect(renamed.status).toHaveBeenCalledWith(403);
        expect(deleted.status).toHaveBeenCalledWith(403);
    });
});
