import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { PUBLIC_VISIBILITY } from './constants';
import { publicEditionsQuerySchema, publicWorksQuerySchema } from './schemas';

type PublicWorksQuery = z.infer<typeof publicWorksQuerySchema>;
type PublicEditionsQuery = z.infer<typeof publicEditionsQuerySchema>;

function buildIdentitySearch(term: string): Prisma.WorkWhereInput {
    return {
        OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { originalTitle: { contains: term, mode: 'insensitive' } },
            {
                authors: {
                    some: {
                        author: {
                            label: { contains: term, mode: 'insensitive' }
                        }
                    }
                }
            }
        ]
    };
}

function buildPublicWorkWhere(
    query: PublicWorksQuery,
    canViewAdultContent: boolean
): Prisma.WorkWhereInput {
    const andFilters: Prisma.WorkWhereInput[] = [];

    if (query.term) {
        andFilters.push(buildIdentitySearch(query.term));
    }

    for (const genreId of query.genreIds || []) {
        andFilters.push({ genres: { some: { genreId } } });
    }

    for (const demography of query.demographics || []) {
        andFilters.push({ demographics: { some: { demography } } });
    }

    return {
        visibility: PUBLIC_VISIBILITY,
        ...(!canViewAdultContent ? { adultContent: false } : {}),
        ...(query.typeId ? { typeId: query.typeId } : {}),
        ...(query.country ? { country: query.country } : {}),
        ...(andFilters.length > 0 ? { AND: andFilters } : {})
    };
}

function buildPublicEditionWhere(
    query: PublicEditionsQuery,
    canViewAdultContent: boolean
): Prisma.EditionWhereInput {
    const workFilters: Prisma.WorkWhereInput = {
        visibility: PUBLIC_VISIBILITY,
        ...(!canViewAdultContent ? { adultContent: false } : {}),
        ...(query.term ? buildIdentitySearch(query.term) : {})
    };

    return {
        visibility: PUBLIC_VISIBILITY,
        work: workFilters,
        ...(query.brazilianPublisherId
            ? { brazilianPublisherId: query.brazilianPublisherId }
            : {}),
        ...(query.formatId ? { formatId: query.formatId } : {}),
        ...(query.coverTypeId ? { coverTypeId: query.coverTypeId } : {})
    };
}

function buildPublicWorkOrderBy(
    sortBy: PublicWorksQuery['sortBy'],
    order: PublicWorksQuery['order']
): Prisma.WorkOrderByWithRelationInput[] {
    const direction = order.toLowerCase() as Prisma.SortOrder;

    if (sortBy === 'originalTitle') {
        return [
            { originalTitle: { sort: direction, nulls: 'last' } },
            { title: direction },
            { id: direction }
        ];
    }

    if (sortBy === 'createdAt') {
        return [{ criadoEm: direction }, { id: direction }];
    }

    return [{ title: direction }, { id: direction }];
}

function buildPublicEditionOrderBy(
    sortBy: PublicEditionsQuery['sortBy'],
    order: PublicEditionsQuery['order']
): Prisma.EditionOrderByWithRelationInput[] {
    const direction = order.toLowerCase() as Prisma.SortOrder;

    if (sortBy === 'chronologicalNumber') {
        return [{ chronologicalNumber: direction }, { id: direction }];
    }

    if (sortBy === 'createdAt') {
        return [{ criadoEm: direction }, { id: direction }];
    }

    return [
        { work: { title: direction } },
        { chronologicalNumber: direction },
        { id: direction }
    ];
}

const publicWorkSelect = {
    id: true,
    slug: true,
    title: true,
    originalTitle: true,
    coverAsset: {
        select: {
            objectKey: true,
            variants: {
                select: { kind: true, objectKey: true }
            }
        }
    },
    country: true,
    type: {
        select: { id: true, label: true }
    },
    authors: {
        select: {
            author: {
                select: { id: true, label: true }
            }
        },
        orderBy: {
            author: { label: 'asc' as const }
        }
    }
} satisfies Prisma.WorkSelect;

const publicEditionSelect = {
    id: true,
    chronologicalNumber: true,
    coverAsset: {
        select: {
            objectKey: true,
            variants: {
                select: { kind: true, objectKey: true }
            }
        }
    },
    work: {
        select: {
            id: true,
            slug: true,
            title: true,
            originalTitle: true,
            authors: {
                select: {
                    author: {
                        select: { id: true, label: true }
                    }
                },
                orderBy: {
                    author: { label: 'asc' as const }
                }
            }
        }
    },
    brazilianPublisher: {
        select: { id: true, label: true }
    },
    format: {
        select: { id: true, label: true }
    },
    coverType: {
        select: { id: true, label: true }
    },
    _count: {
        select: { volumes: true }
    }
} satisfies Prisma.EditionSelect;

export {
    buildIdentitySearch,
    buildPublicWorkWhere,
    buildPublicEditionWhere,
    buildPublicWorkOrderBy,
    buildPublicEditionOrderBy,
    publicWorkSelect,
    publicEditionSelect
};
