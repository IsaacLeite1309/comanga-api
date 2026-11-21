const prisma = {
    domainOptionCategory: {
        findUnique: jest.fn()
    }
};

jest.mock('../../src/prisma', () => prisma);

const {
    findCategoryBySlug,
    findListableCategoryBySlug,
    isListableOptionCategory,
    isManageableOptionCategory
} = require('../../src/modules/admin/options/services');

describe('politica de categorias administrativas', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([
        'autores',
        'tipos-obra',
        'generos',
        'editoras-originais',
        'revistas-serializacao',
        'editoras-brasileiras',
        'tipos-capa',
        'formatos-fisicos',
        'miolos'
    ])('permite a categoria gerenciavel %s', (slug) => {
        expect(isManageableOptionCategory(slug)).toBe(true);
        expect(isListableOptionCategory(slug)).toBe(true);
    });

    it('não oferece país de origem como opção administrativa', async () => {
   expect(isManageableOptionCategory('paises-origem')).toBe(false);expect(isListableOptionCategory('paises-origem')).toBe(false);
   await expect(findListableCategoryBySlug('paises-origem')).resolves.toBeNull();expect(prisma.domainOptionCategory.findUnique).not.toHaveBeenCalled();
 });

    it.each([
        'paises-origem',
        'papeis-autor',
        'demografias',
        'status-publicacao-original'
    ])('recusa a categoria interna ou nao utilizada %s antes de consultar o banco', async (slug) => {
        expect(isManageableOptionCategory(slug)).toBe(false);
        await expect(findCategoryBySlug(slug)).resolves.toBeNull();
        expect(prisma.domainOptionCategory.findUnique).not.toHaveBeenCalled();
    });
});
