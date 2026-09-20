const {
    buildPublicEditionOrderBy,
    buildPublicEditionWhere,
    buildPublicWorkOrderBy,
    buildPublicWorkWhere
} = require('../src/modules/public-catalog/queries');
const {
    publicEditionsQuerySchema,
    publicWorksQuerySchema
} = require('../src/modules/public-catalog/schemas');
const {
    mapPublicEdition,
    mapPublicWork
} = require('../src/modules/public-catalog/mappers');

const HENTAI_RESTRICTION = { genres: { none: { genre: { code: 'hentai', category: { slug: 'generos' } } } } };

describe('contratos unitários do catálogo público', () => {
    it('normaliza filtros combináveis repetidos e separados por vírgula', () => {
        const result = publicWorksQuerySchema.parse({
            genreIds: ['10,20', '20'],
            demographics: ['Shonen', 'Seinen,Shonen'],
            page: '2',
            limit: '50'
        });

        expect(result).toEqual(expect.objectContaining({
            genreIds: [10, 20],
            demographics: ['Shonen', 'Seinen'],
            page: 2,
            limit: 50
        }));
    });

    it('rejeita paginação além do limite público', () => {
        expect(publicWorksQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
        expect(publicEditionsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    });

    it('rejeita status desconhecidos e número de Edição não positivo', () => {
        expect(publicWorksQuerySchema.safeParse({
            originalPublicationStatus: 'Desconhecido'
        }).success).toBe(false);
        expect(publicEditionsQuerySchema.safeParse({
            brazilPublicationStatus: 'Desconhecido'
        }).success).toBe(false);
        expect(publicEditionsQuerySchema.safeParse({
            chronologicalNumber: 0
        }).success).toBe(false);
        expect(publicWorksQuerySchema.safeParse({
            originalPublicationStartYear: 1899
        }).success).toBe(false);
        expect(publicEditionsQuerySchema.safeParse({
            brazilPublicationEndYear: new Date().getFullYear() + 2
        }).success).toBe(false);
        expect(publicWorksQuerySchema.safeParse({
            originalPublicationEndYear: new Date().getFullYear() + 1
        }).success).toBe(true);
    });

    it('representa cada Gênero e Demografia como uma condição obrigatória independente', () => {
        const query = publicWorksQuerySchema.parse({
            term: 'Urasawa',
            typeId: 3,
            country: 'Japão',
            genreIds: '11,12',
            demographics: 'Shonen,Seinen',
            originalPublisherId: 31,
            serializationMagazineId: 32,
            originalPublicationStatus: 'Em andamento',
            originalPublicationStartYear: 1999,
            originalPublicationEndYear: 2014
        });
        const where = buildPublicWorkWhere(query, false);

        expect(where).toEqual(expect.objectContaining({
            visibility: 'Público',
            adultContent: false,
            ...HENTAI_RESTRICTION,
            typeId: 3,
            country: 'Japão',
            originalPublishers: { some: { publisherId: 31 } },
            serializationMagazines: { some: { magazineId: 32 } },
            originalPublicationStatus: 'Em andamento',
            originalPublicationStartYear: 1999,
            originalPublicationEndYear: 2014
        }));
        expect(where.AND).toEqual(expect.arrayContaining([
            { genres: { some: { genreId: 11 } } },
            { genres: { some: { genreId: 12 } } },
            { demographics: { some: { demography: 'Shonen' } } },
            { demographics: { some: { demography: 'Seinen' } } }
        ]));
        expect(where.AND).toHaveLength(5);
    });

    it('mantém privadas bloqueadas e só remove a condição adulta para viewer elegível', () => {
        const query = publicWorksQuerySchema.parse({});

        expect(buildPublicWorkWhere(query, false)).toEqual({
            visibility: 'Público',
            adultContent: false,
            ...HENTAI_RESTRICTION
        });
        expect(buildPublicWorkWhere(query, true)).toEqual({
            visibility: 'Público'
        });
    });

    it('aplica identidade da Obra, ambas as visibilidades e filtros editoriais às Edições', () => {
        const query = publicEditionsQuerySchema.parse({
            term: 'Monster',
            brazilianPublisherId: 21,
            editionTypeId: 24,
            formatId: 22,
            coverTypeId: 23,
            chronologicalNumber: 2,
            brazilPublicationStatus: 'Em hiato',
            brazilPublicationStartYear: 2020,
            brazilPublicationEndYear: 2024
        });
        expect(query).toEqual(expect.objectContaining({
            brazilPublicationStartYear: 2020,
            brazilPublicationEndYear: 2024
        }));
        const where = buildPublicEditionWhere(query, false);

        expect(where).toEqual(expect.objectContaining({
            visibility: 'Público',
            brazilianPublisherId: 21,
            editionTypeId: 24,
            formatId: 22,
            coverTypeId: 23,
            chronologicalNumber: 2,
            brazilPublicationStatus: 'Em hiato',
            work: expect.objectContaining({
                visibility: 'Público',
                adultContent: false,
                ...HENTAI_RESTRICTION,
                OR: expect.any(Array)
            })
        }));
    });

    it('sempre acrescenta desempate determinístico à ordenação', () => {
        expect(buildPublicWorkOrderBy('title', 'ASC')).toEqual([
            { title: 'asc' },
            { id: 'asc' }
        ]);
        expect(buildPublicEditionOrderBy('title', 'DESC')).toEqual([
            { work: { title: 'desc' } },
            { chronologicalNumber: 'desc' },
            { id: 'desc' }
        ]);
    });

    it('projeta somente metadados públicos resumidos e usa a contagem relacional', () => {
        const work = mapPublicWork({
            id: 1,
            slug: 'monster',
            title: 'Monster',
            originalTitle: null,
            coverAsset: null,
            country: 'Japão',
            type: { id: 2, label: 'Mangá' },
            authors: [{ author: { id: 3, label: 'Naoki Urasawa' } }],
            visibility: 'Público',
            adultContent: true
        });
        const edition = mapPublicEdition({
            id: 4,
            chronologicalNumber: 1,
            volumes: [],
            work: {
                id: 1,
                slug: 'monster',
                title: 'Monster',
                originalTitle: null,
                authors: [{ author: { id: 3, label: 'Naoki Urasawa' } }]
            },
            brazilianPublisher: { id: 5, label: 'Panini' },
            format: { id: 6, label: 'Tankobon' },
            coverType: { id: 7, label: 'Brochura' },
            _count: { volumes: 18 },
            manualVolumeCount: 99
        });

        expect(work).not.toHaveProperty('visibility');
        expect(work).not.toHaveProperty('adultContent');
        expect(edition).not.toHaveProperty('manualVolumeCount');
        expect(edition.volumesCount).toBe(18);
        // Sem Volume 1 público não há capa derivada nem recurso alternativo.
        expect(edition.coverUrl).toBeNull();
    });
});
