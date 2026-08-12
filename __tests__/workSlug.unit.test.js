const {
    buildWorkSlugBase,
    createUniqueWorkSlug
} = require('../src/modules/catalog/works/workSlug');

describe('slugs de Obras', () => {
    it('normaliza acentos, pontuacao e espacos para uma URL legivel', () => {
        expect(buildWorkSlugBase('JoJo’s Bizarre Adventure: Parte 5')).toBe(
            'jojo-s-bizarre-adventure-parte-5'
        );
    });

    it('usa um identificador seguro quando o titulo nao produz caracteres validos', () => {
        expect(buildWorkSlugBase(' 漫画 ')).toBe('obra');
    });

    it('resolve colisoes com sufixo numerico sem alterar o slug base', async () => {
        const repository = {
            findUnique: jest
                .fn()
                .mockResolvedValueOnce({ id: 1 })
                .mockResolvedValueOnce({ id: 2 })
                .mockResolvedValueOnce(null)
        };

        await expect(createUniqueWorkSlug('Pluto', repository)).resolves.toBe('pluto-3');
        expect(repository.findUnique).toHaveBeenNthCalledWith(1, {
            where: { slug: 'pluto' },
            select: { id: true }
        });
        expect(repository.findUnique).toHaveBeenNthCalledWith(3, {
            where: { slug: 'pluto-3' },
            select: { id: true }
        });
    });

    it('limita o slug ao tamanho aceito pelo banco', () => {
        expect(buildWorkSlugBase('A'.repeat(400))).toHaveLength(240);
    });
});
