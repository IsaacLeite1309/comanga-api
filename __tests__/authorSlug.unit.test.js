const { authorSlugBase, availableAuthorSlug } = require('../src/utils/authorSlug');

describe('endereço público de Autor', () => {
    it('gera um nome legível sem acentos e preserva apenas caracteres seguros para URL', () => {
        expect(authorSlugBase('  João & Maria  ')).toBe('joao-maria');
        expect(authorSlugBase('鳥山 明')).toBe('鳥山-明');
        expect(authorSlugBase('---')).toBe('autor');
    });

    it('desempata nomes equivalentes sem substituir o endereço de outro Autor', async () => {
        const existing = new Set(['joao-maria', 'joao-maria-2']);
        const slug = await availableAuthorSlug(7, 'João Maria', async (_categoryId, code) => existing.has(code));
        expect(slug).toBe('joao-maria-3');
    });
});
