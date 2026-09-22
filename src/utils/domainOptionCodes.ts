import type { Prisma } from '@prisma/client';

// Identidades compartilhadas das classificações oficiais do catálogo.
const WORK_TYPE_CATEGORY_SLUG = 'tipos-obra';
const GENRE_CATEGORY_SLUG = 'generos';
const HENTAI_GENRE_CODE = 'hentai';
// O marcador preserva a restrição de aliases legados sem substituir seus IDs.
const HENTAI_GENRE_FILTER = {
    category: { slug: GENRE_CATEGORY_SLUG },
    OR: [{ code: HENTAI_GENRE_CODE }, { adultOnly: true }]
} satisfies Prisma.DomainOptionValueWhereInput;
const SYSTEM_MANAGED_OPTION_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
    WORK_TYPE_CATEGORY_SLUG, GENRE_CATEGORY_SLUG
]);
const ORDERED_OPTION_CATEGORY_SLUGS = SYSTEM_MANAGED_OPTION_CATEGORY_SLUGS;
function isSystemManagedOptionCategory(slug: string) {
    return SYSTEM_MANAGED_OPTION_CATEGORY_SLUGS.has(slug);
}
function isOrderedOptionCategory(slug: string) {
    return ORDERED_OPTION_CATEGORY_SLUGS.has(slug);
}
export {
    WORK_TYPE_CATEGORY_SLUG, GENRE_CATEGORY_SLUG, HENTAI_GENRE_CODE, HENTAI_GENRE_FILTER,
    SYSTEM_MANAGED_OPTION_CATEGORY_SLUGS, ORDERED_OPTION_CATEGORY_SLUGS,
    isSystemManagedOptionCategory, isOrderedOptionCategory
};
