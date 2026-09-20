// Identidade estável das opções controladas pelo sistema (seções 11 a 14 do guia).
// Fica em `src/utils` porque a política é compartilhada entre catálogo, área
// administrativa e catálogo público, que não dependem uns dos outros.
const WORK_TYPE_CATEGORY_SLUG = 'tipos-obra';
const GENRE_CATEGORY_SLUG = 'generos';
const EDITION_TYPE_CATEGORY_SLUG = 'tipos-edicao';

const HENTAI_GENRE_CODE = 'hentai';

// Categorias cujos valores oficiais são semeados por migration: nada de criar,
// excluir ou renomear pela área administrativa.
const SYSTEM_MANAGED_OPTION_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
    WORK_TYPE_CATEGORY_SLUG,
    GENRE_CATEGORY_SLUG
]);

// Categorias em que `position` é significativa para exibição.
const ORDERED_OPTION_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
    GENRE_CATEGORY_SLUG,
    EDITION_TYPE_CATEGORY_SLUG
]);

// Categorias em que o administrador pode reordenar manualmente.
const REORDERABLE_OPTION_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
    EDITION_TYPE_CATEGORY_SLUG
]);

function isSystemManagedOptionCategory(slug: string) {
    return SYSTEM_MANAGED_OPTION_CATEGORY_SLUGS.has(slug);
}

function isOrderedOptionCategory(slug: string) {
    return ORDERED_OPTION_CATEGORY_SLUGS.has(slug);
}

function isReorderableOptionCategory(slug: string) {
    return REORDERABLE_OPTION_CATEGORY_SLUGS.has(slug);
}

export {
    WORK_TYPE_CATEGORY_SLUG,
    GENRE_CATEGORY_SLUG,
    EDITION_TYPE_CATEGORY_SLUG,
    HENTAI_GENRE_CODE,
    SYSTEM_MANAGED_OPTION_CATEGORY_SLUGS,
    ORDERED_OPTION_CATEGORY_SLUGS,
    REORDERABLE_OPTION_CATEGORY_SLUGS,
    isSystemManagedOptionCategory,
    isOrderedOptionCategory,
    isReorderableOptionCategory
};
