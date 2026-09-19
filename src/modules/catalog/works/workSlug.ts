const WORK_SLUG_BASE_MAX_LENGTH = 240;

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

async function createUniqueWorkSlug(title: string, repository: WorkSlugRepository) {
    const baseSlug = buildWorkSlugBase(title);
    let candidate = baseSlug;
    let collisionNumber = 2;

    while (await repository.findUnique({
        where: { slug: candidate },
        select: { id: true }
    })) {
        candidate = `${baseSlug}-${collisionNumber}`;
        collisionNumber += 1;
    }

    return candidate;
}

export {
    WORK_SLUG_BASE_MAX_LENGTH,
    buildWorkSlugBase,
    createUniqueWorkSlug
};
