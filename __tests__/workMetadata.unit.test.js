const fs = require('node:fs');
const path = require('node:path');

const {
    createWorkSchema,
    updateWorkSchema,
    workAuthorSchema
} = require('../src/modules/catalog/schemas');
const {
    normalizeOrderedAuthors,
    sortAuthorsByCredit,
    normalizeWorkDetail,
    normalizeWorkSummary
} = require('../src/modules/catalog/mappers');
const {
    getWorkDetailInclude,
    getWorkSummaryInclude
} = require('../src/modules/catalog/queries');
const {
    buildIdentitySearch,
    publicWorkDetailSelect,
    publicWorkSelect
} = require('../src/modules/public-catalog/queries');
const { mapPublicWorkDetails } = require('../src/modules/public-catalog/mappers');

const migrationDirectory = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260920121000_work_metadata_and_author_positions'
);

function validWorkPayload(overrides = {}) {
    return {
        title: 'Lobo Solitário',
        romanizedTitle: 'Kozure Ōkami',
        synopsis: 'Um samurai percorre o Japão feudal com o filho.',
        typeId: 1,
        country: 'Japão',
        originalPublicationStatus: 'Completa',
        coverAssetId: '7f28c7f0-c94f-46e8-b61c-6ea716f8f28e',
        authors: [{ authorId: 4, roles: ['História'] }],
        ...overrides
    };
}

describe('contrato dos metadados próprios da Obra', () => {
    it('impede créditos redundantes de História e Arte para o mesmo autor', () => {
        const combinedAndSeparateCredit = workAuthorSchema.safeParse({
            authorId: 4,
            roles: ['História e Arte', 'História']
        });
        const separateCredits = workAuthorSchema.safeParse({
            authorId: 4,
            roles: ['História', 'Arte']
        });
        const compatibleCredits = workAuthorSchema.safeParse({
            authorId: 4,
            roles: ['Criador Original', 'Ilustrador']
        });

        expect(combinedAndSeparateCredit.success).toBe(false);
        expect(combinedAndSeparateCredit.error.issues[0].path).toEqual(['roles']);
        expect(separateCredits.success).toBe(false);
        expect(compatibleCredits.success).toBe(true);
    });

    it('exige título romanizado e sinopse no cadastro', () => {
        const withoutRomanizedTitle = createWorkSchema.safeParse(
            validWorkPayload({ romanizedTitle: undefined })
        );
        const withoutSynopsis = createWorkSchema.safeParse(validWorkPayload({ synopsis: undefined }));
        const blankValues = createWorkSchema.safeParse(
            validWorkPayload({ romanizedTitle: '   ', synopsis: '   ' })
        );

        expect(withoutRomanizedTitle.success).toBe(false);
        expect(withoutSynopsis.success).toBe(false);
        expect(blankValues.success).toBe(false);
    });

    it('aceita cadastro completo preservando título em português e título original opcional', () => {
        const withoutOriginalTitle = createWorkSchema.safeParse(validWorkPayload());
        const withOriginalTitle = createWorkSchema.safeParse(
            validWorkPayload({ originalTitle: '子連れ狼' })
        );

        expect(withoutOriginalTitle.success).toBe(true);
        expect(withoutOriginalTitle.data.title).toBe('Lobo Solitário');
        expect(withoutOriginalTitle.data.romanizedTitle).toBe('Kozure Ōkami');
        expect(withoutOriginalTitle.data.originalTitle).toBeUndefined();
        expect(withOriginalTitle.success).toBe(true);
        expect(withOriginalTitle.data.originalTitle).toBe('子連れ狼');
    });

    it('recusa título romanizado ou sinopse vazios na alteração e aceita sua ausência', () => {
        const blankRomanizedTitle = updateWorkSchema.safeParse({ romanizedTitle: '   ' });
        const blankSynopsis = updateWorkSchema.safeParse({ synopsis: '' });
        const absentFields = updateWorkSchema.safeParse({ title: 'Outro título' });

        expect(blankRomanizedTitle.success).toBe(false);
        expect(blankSynopsis.success).toBe(false);
        expect(absentFields.success).toBe(true);
        expect(absentFields.data).not.toHaveProperty('romanizedTitle');
    });

    it('não aceita título romanizado nulo, diferentemente do título original', () => {
        expect(updateWorkSchema.safeParse({ romanizedTitle: null }).success).toBe(false);
        expect(updateWorkSchema.safeParse({ synopsis: null }).success).toBe(false);
        expect(updateWorkSchema.safeParse({ originalTitle: null }).success).toBe(true);
    });

    it('expõe título romanizado no resumo e sinopse nos detalhes administrativos', () => {
        const summary = normalizeWorkSummary({
            id: 1,
            slug: 'lobo-solitario',
            title: 'Lobo Solitário',
            originalTitle: '子連れ狼',
            romanizedTitle: 'Kozure Ōkami',
            visibility: 'Privado',
            adultContent: false,
            coverAssetId: null,
            coverAsset: null,
            type: { id: 1, label: 'Mangá' },
            country: 'Japão',
            authors: []
        });
        const detail = normalizeWorkDetail({
            ...summary,
            coverAsset: null,
            type: { id: 1, label: 'Mangá' },
            synopsis: 'A sinopse própria da Obra.',
            originalPublicationStartYear: null,
            originalPublicationEndYear: null,
            originalVolumeCount: null,
            directRelease: false,
            originalPublicationStatus: 'Completa'
        });

        expect(summary.romanizedTitle).toBe('Kozure Ōkami');
        expect(summary.title).toBe('Lobo Solitário');
        expect(summary.originalTitle).toBe('子連れ狼');
        expect(detail.romanizedTitle).toBe('Kozure Ōkami');
        expect(detail.synopsis).toBe('A sinopse própria da Obra.');
    });

    it('pesquisa pública considera título romanizado junto de título, título original e Autor', () => {
        const search = buildIdentitySearch('kozure');

        expect(search.OR).toEqual(expect.arrayContaining([
            { romanizedTitle: { contains: 'kozure', mode: 'insensitive' } }
        ]));
        expect(search.OR).toHaveLength(4);
    });

    it('seleciona os novos campos nas consultas públicas', () => {
        expect(publicWorkSelect.romanizedTitle).toBe(true);
        expect(publicWorkDetailSelect.romanizedTitle).toBe(true);
        expect(publicWorkDetailSelect.synopsis).toBe(true);
    });

    it('versiona a migration com backfill transitório antes da obrigatoriedade', () => {
        const sql = fs.readFileSync(path.join(migrationDirectory, 'migration.sql'), 'utf8');
        const romanizedBackfillIndex = sql.indexOf('SET romanized_title = title');
        const romanizedNotNullIndex = sql.indexOf('ALTER COLUMN romanized_title SET NOT NULL');
        const synopsisBackfillIndex = sql.indexOf('SET synopsis = title');
        const synopsisNotNullIndex = sql.indexOf('ALTER COLUMN synopsis SET NOT NULL');

        expect(romanizedBackfillIndex).toBeGreaterThan(-1);
        expect(romanizedNotNullIndex).toBeGreaterThan(romanizedBackfillIndex);
        expect(synopsisBackfillIndex).toBeGreaterThan(-1);
        expect(synopsisNotNullIndex).toBeGreaterThan(synopsisBackfillIndex);
        expect(sql).toContain('idx_works_romanized_title_trgm');
        expect(sql).not.toMatch(/UPDATE\s+volumes/i);
    });
});

describe('sinopse própria na página pública da Obra', () => {
    const previousMediaUrl = process.env.MEDIA_PUBLIC_BASE_URL;

    beforeAll(() => {
        process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.comanga.test';
    });

    afterAll(() => {
        if (previousMediaUrl === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
        else process.env.MEDIA_PUBLIC_BASE_URL = previousMediaUrl;
    });

    function publicWorkFixture(overrides = {}) {
        return {
            id: 8,
            slug: 'lobo-solitario',
            title: 'Lobo Solitário',
            originalTitle: '子連れ狼',
            romanizedTitle: 'Kozure Ōkami',
            synopsis: 'A sinopse própria da Obra.',
            coverAsset: null,
            type: { id: 1, label: 'Mangá' },
            country: 'Japão',
            originalPublicationStartYear: 1970,
            originalPublicationEndYear: 1976,
            originalVolumeCount: 28,
            directRelease: false,
            originalPublicationStatus: 'Completa',
            authors: [{ position: 0, author: { id: 2, label: 'Kazuo Koike' }, roles: [{ role: 'História' }] }],
            genres: [],
            demographics: [],
            serializationMagazines: [],
            originalPublishers: [],
            editions: [{
                id: 10,
                chronologicalNumber: 1,
                brazilPublicationStatus: 'Completa',
                coverAsset: null,
                brazilianPublisher: { id: 6, label: 'Panini' },
                editionType: { id: 7, label: 'Regular' },
                format: { id: 8, label: 'Tankobon' },
                coverType: { id: 9, label: 'Brochura' },
                _count: { volumes: 1 },
                volumes: [{
                    id: 20,
                    number: 1,
                    singleVolume: false,
                    releaseDatePrecision: 'Ano',
                    releaseYear: 2025,
                    releaseMonth: null,
                    releaseDay: null,
                    coverAsset: null
                }]
            }],
            ...overrides
        };
    }

    it('usa exclusivamente a sinopse da Obra e expõe os dois títulos separadamente', () => {
        const details = mapPublicWorkDetails(publicWorkFixture());

        expect(details.synopsis).toBe('A sinopse própria da Obra.');
        expect(details.title).toBe('Lobo Solitário');
        expect(details.originalTitle).toBe('子連れ狼');
        expect(details.romanizedTitle).toBe('Kozure Ōkami');
    });

    it('ignora a sinopse do Volume 1 da primeira Edição pública', () => {
        const work = publicWorkFixture({ synopsis: 'Somente a sinopse da Obra.' });
        work.editions[0].volumes[0].synopsis = 'Sinopse do Volume 1.';

        expect(mapPublicWorkDetails(work).synopsis).toBe('Somente a sinopse da Obra.');
        expect(publicWorkDetailSelect.editions.select.volumes.select).not.toHaveProperty('synopsis');
    });
});

describe('ordem editorial dos Autores', () => {
    it('ordena créditos pelo papel e depois pelo nome do autor', () => {
        const authors = sortAuthorsByCredit([
            { author: { id: 1, label: 'Zeta' }, roles: [{ role: 'Ilustrador' }] },
            { author: { id: 2, label: 'Beta' }, roles: [{ role: 'História' }] },
            { author: { id: 3, label: 'Alfa' }, roles: [{ role: 'História' }] },
            { author: { id: 4, label: 'Gama' }, roles: [{ role: 'Criador Original' }] }
        ]);

        expect(authors.map((item) => item.author.label)).toEqual(['Gama', 'Alfa', 'Beta', 'Zeta']);
    });

    it('normaliza posições contíguas a partir de 0 pela ordem recebida', () => {
        expect(normalizeOrderedAuthors([
            { authorId: 11, roles: ['Ilustrador'] },
            { authorId: 4, roles: ['História'] }
        ])).toEqual([
            { authorId: 11, roles: ['Ilustrador'], position: 0 },
            { authorId: 4, roles: ['História'], position: 1 }
        ]);
    });

    it('normaliza buracos e posições duplicadas sem recusar o payload', () => {
        expect(normalizeOrderedAuthors([
            { authorId: 4, roles: ['História'], position: 7 },
            { authorId: 11, roles: ['Arte'], position: 2 }
        ]).map(({ authorId, position }) => ({ authorId, position }))).toEqual([
            { authorId: 4, position: 0 },
            { authorId: 11, position: 1 }
        ]);
        expect(normalizeOrderedAuthors([
            { authorId: 4, roles: ['História'], position: 0 },
            { authorId: 11, roles: ['Arte'], position: 0 }
        ]).map(({ authorId, position }) => ({ authorId, position }))).toEqual([
            { authorId: 4, position: 0 },
            { authorId: 11, position: 1 }
        ]);
    });

    it('aceita posição opcional por item no contrato de autoria', () => {
        const withPosition = workAuthorSchema.safeParse({ authorId: 4, roles: ['História'], position: 3 });
        const withoutPosition = workAuthorSchema.safeParse({ authorId: 4, roles: ['História'] });
        const negativePosition = workAuthorSchema.safeParse({ authorId: 4, roles: ['História'], position: -1 });

        expect(withPosition.success).toBe(true);
        expect(withPosition.data.position).toBe(3);
        expect(withoutPosition.success).toBe(true);
        expect(negativePosition.success).toBe(false);
    });

    it('ordena autores pelo papel, ignorando posições previamente persistidas', () => {
        const authors = [
            { position: 1, author: { id: 4, label: 'Masashi Kishimoto' }, roles: [{ role: 'História e Arte' }] },
            { position: 0, author: { id: 11, label: 'Osamu Tezuka' }, roles: [{ role: 'Ilustrador' }] }
        ];
        const detail = normalizeWorkDetail({
            id: 1,
            slug: 'obra',
            title: 'Obra',
            originalTitle: null,
            romanizedTitle: 'Obra',
            synopsis: 'Sinopse.',
            visibility: 'Privado',
            adultContent: false,
            coverAssetId: null,
            coverAsset: null,
            type: { id: 1, label: 'Mangá' },
            country: 'Japão',
            originalPublicationStartYear: null,
            originalPublicationEndYear: null,
            originalVolumeCount: null,
            directRelease: false,
            originalPublicationStatus: 'Completa',
            authors
        });

        expect(detail.authors.map((item) => item.author.id)).toEqual([4, 11]);
        expect(detail.authors[0].roles).toEqual(['História e Arte']);
        expect(detail.authors[1].roles).toEqual(['Ilustrador']);
    });

    it('consulta autores ordenados por posição na área administrativa e no catálogo público', () => {
        const expectedOrder = [{ position: 'asc' }, { authorId: 'asc' }];

        expect(getWorkSummaryInclude().authors.orderBy).toEqual(expectedOrder);
        expect(getWorkSummaryInclude().authors.select.position).toBe(true);
        expect(getWorkDetailInclude().authors.orderBy).toEqual(expectedOrder);
        expect(publicWorkSelect.authors.orderBy).toEqual(expectedOrder);
        expect(publicWorkDetailSelect.authors.orderBy).toEqual(expectedOrder);
    });

    it('versiona a posição de autores com índice e backfill alfabético', () => {
        const sql = fs.readFileSync(path.join(migrationDirectory, 'migration.sql'), 'utf8');

        expect(sql).toMatch(/ALTER TABLE "?work_authors"?[\s\S]*ADD COLUMN IF NOT EXISTS "?position"?/i);
        expect(sql).toContain('idx_work_authors_position');
        expect(sql).toMatch(/ROW_NUMBER\(\)[\s\S]*PARTITION BY[\s\S]*ORDER BY[\s\S]*label/i);
    });
});
