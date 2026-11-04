const WORK_SLUG_BASE_MAX_LENGTH = 240;
const WORK_SLUG_MAX_LENGTH = 255;

interface WorkSlugRepository {
    findUnique(args: {
        where: { slug: string };
        select: { id: true };
    }): Promise<{ id: number } | null>;
}

function buildWorkSlugBase(title: string) {
    const normalized = title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, WORK_SLUG_BASE_MAX_LENGTH)
        .replace(/-+$/g, '');

    return normalized || 'obra';
}

async function createUniqueWorkSlug(title: string, typeCode: string, repository: WorkSlugRepository) {
    const baseSlug = buildWorkSlugBase(title);
    const existingBase = await repository.findUnique({
        where: { slug: baseSlug },
        select: { id: true }
    });
    if (!existingBase) return baseSlug;

    const typeSuffix = buildWorkSlugBase(typeCode);
    const typedBase = `${baseSlug.slice(0, WORK_SLUG_MAX_LENGTH - typeSuffix.length - 1).replace(/-+$/g, '')}-${typeSuffix}`;
    let candidate = typedBase;
    let collisionNumber = 2;
    while (await repository.findUnique({ where: { slug: candidate }, select: { id: true } })) {
        const numericSuffix = `-${collisionNumber}`;
        candidate = `${typedBase.slice(0, WORK_SLUG_MAX_LENGTH - numericSuffix.length).replace(/-+$/g, '')}${numericSuffix}`;
        collisionNumber += 1;
    }

    return candidate;
}

export {
    WORK_SLUG_BASE_MAX_LENGTH,
    buildWorkSlugBase,
    createUniqueWorkSlug
};
