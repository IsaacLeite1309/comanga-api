const PUBLIC_VISIBILITY = 'Público';
const PUBLIC_AUTHOR_CATEGORY = 'autores';

const PUBLIC_WORK_COUNTRIES = [
    'Japão',
    'Coreia do Sul',
    'China',
    'Taiwan'
] as const;

const PUBLIC_WORK_DEMOGRAPHICS = [
    'Shonen',
    'Seinen',
    'Shoujo',
    'Josei',
    'Kodomo'
] as const;

const PUBLIC_PUBLICATION_STATUSES = [
    'Completa',
    'Em andamento',
    'Em hiato',
    'Cancelada'
] as const;

const PUBLIC_CATALOG_OPTION_CATEGORIES = {
    workTypes: 'tipos-obra',
    genres: 'generos',
    originalPublishers: 'editoras-originais',
    serializationMagazines: 'revistas-serializacao',
    brazilianPublishers: 'editoras-brasileiras',
    editionTypes: 'tipos-edicao',
    formats: 'formatos-fisicos',
    coverTypes: 'tipos-capa'
} as const;

export {
    PUBLIC_VISIBILITY,
    PUBLIC_AUTHOR_CATEGORY,
    PUBLIC_WORK_COUNTRIES,
    PUBLIC_WORK_DEMOGRAPHICS,
    PUBLIC_PUBLICATION_STATUSES,
    PUBLIC_CATALOG_OPTION_CATEGORIES
};
