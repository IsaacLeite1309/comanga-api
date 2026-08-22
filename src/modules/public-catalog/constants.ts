const PUBLIC_VISIBILITY = 'Público';
const PUBLIC_AUTHOR_CATEGORY = 'autores';

const PUBLIC_WORK_COUNTRIES = [
    'China',
    'Coreia do Sul',
    'Japão',
    'Taiwan'
] as const;

const PUBLIC_WORK_DEMOGRAPHICS = [
    'Josei',
    'Kodomo',
    'Seinen',
    'Shonen',
    'Shoujo'
] as const;

const PUBLIC_CATALOG_OPTION_CATEGORIES = {
    workTypes: 'tipos-obra',
    genres: 'generos',
    brazilianPublishers: 'editoras-brasileiras',
    formats: 'formatos-fisicos',
    coverTypes: 'tipos-capa'
} as const;

export {
    PUBLIC_VISIBILITY,
    PUBLIC_AUTHOR_CATEGORY,
    PUBLIC_WORK_COUNTRIES,
    PUBLIC_WORK_DEMOGRAPHICS,
    PUBLIC_CATALOG_OPTION_CATEGORIES
};
