const prisma = {
    domainOptionCategory: {
        findUnique: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const {
    findCategoryBySlug,
    findListableCategoryBySlug,
    isListableOptionCategory,
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
        expect(isListableOptionCategory(slug)).toBe(true);
    });

    it('lista paises de origem como referencia sem permitir sua edicao', async () => {
        prisma.domainOptionCategory.findUnique.mockResolvedValueOnce({
            id: 4,
            slug: 'paises-origem',
            name: 'País de origem'
        });

        expect(isManageableOptionCategory('paises-origem')).toBe(false);
        expect(isListableOptionCategory('paises-origem')).toBe(true);
        await expect(findListableCategoryBySlug('paises-origem')).resolves.toEqual({
            id: 4,
            slug: 'paises-origem',
            name: 'País de origem'
        });
        expect(prisma.domainOptionCategory.findUnique).toHaveBeenCalledWith({
            where: { slug: 'paises-origem' }
        });
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
