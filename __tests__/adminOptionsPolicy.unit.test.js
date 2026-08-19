const prisma = {
    domainOptionCategory: {
        findUnique: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const {
    findCategoryBySlug,
    isManageableOptionCategory
} = require('../src/modules/admin/optionServices');

describe('politica de categorias administrativas', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([
        'autores',
        'tipos-obra',
        'generos',
        'editoras-originais',
        'revistas-serializacao',
        'editoras-brasileiras',
        'tipos-edicao',
        'tipos-capa',
        'formatos-fisicos'
    ])('permite a categoria gerenciavel %s', (slug) => {
        expect(isManageableOptionCategory(slug)).toBe(true);
    });

    it.each([
        'paises-origem',
        'papeis-autor',
        'demografias',
        'status-publicacao-original',
        'miolos'
    ])('recusa a categoria interna ou nao utilizada %s antes de consultar o banco', async (slug) => {
        expect(isManageableOptionCategory(slug)).toBe(false);
        await expect(findCategoryBySlug(slug)).resolves.toBeNull();
        expect(prisma.domainOptionCategory.findUnique).not.toHaveBeenCalled();
    });
});
