export function authorSlugBase(label: string) {
    return label.normalize('NFD').replace(/\p{M}/gu, '')
        .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 70) || 'autor';
}

export async function availableAuthorSlug(
    categoryId: number,
    label: string,
    exists: (categoryId: number, code: string) => Promise<boolean>
) {
    const base = authorSlugBase(label);
    let candidate = base;
    let suffix = 2;
    while (await exists(categoryId, candidate)) candidate = `${base.slice(0, 70 - String(suffix).length - 1)}-${suffix++}`;
    return candidate;
}
