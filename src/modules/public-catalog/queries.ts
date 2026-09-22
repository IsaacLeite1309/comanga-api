import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { EDITION_COVER_SOURCE_VOLUME_NUMBER, PUBLIC_VISIBILITY } from './constants';
import { buildAdultWorkRestriction } from './adultContentPolicy';
import {
    publicAuthorWorksQuerySchema,
    publicEditionsQuerySchema,
    publicWorksQuerySchema
} from './schemas';

type PublicWorksQuery = z.infer<typeof publicWorksQuerySchema>;
type PublicEditionsQuery = z.infer<typeof publicEditionsQuerySchema>;
type PublicAuthorWorksQuery = z.infer<typeof publicAuthorWorksQuerySchema>;

function buildIdentitySearch(term: string): Prisma.WorkWhereInput {
    return {
        OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { originalTitle: { contains: term, mode: 'insensitive' } },
            { romanizedTitle: { contains: term, mode: 'insensitive' } },
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
        ...buildAdultWorkRestriction(canViewAdultContent),
        ...(query.typeId ? { typeId: query.typeId } : {}),
        ...(query.country ? { country: query.country } : {}),
        ...(query.originalPublisherId
            ? { originalPublishers: { some: { publisherId: query.originalPublisherId } } }
            : {}),
        ...(query.serializationMagazineId
            ? { serializationMagazines: { some: { magazineId: query.serializationMagazineId } } }
            : {}),
        ...(query.originalPublicationStatus
            ? { originalPublicationStatus: query.originalPublicationStatus }
            : {}),
        ...(query.originalPublicationStartYear
            ? { originalPublicationStartYear: query.originalPublicationStartYear }
            : {}),
        ...(query.originalPublicationEndYear
            ? { originalPublicationEndYear: query.originalPublicationEndYear }
            : {}),
        ...(andFilters.length > 0 ? { AND: andFilters } : {})
    };
}

function buildPublicEditionWhere(
    query: PublicEditionsQuery,
    canViewAdultContent: boolean
): Prisma.EditionWhereInput {
    const workFilters: Prisma.WorkWhereInput = {
        visibility: PUBLIC_VISIBILITY,
        ...buildAdultWorkRestriction(canViewAdultContent),
        ...(query.term ? buildIdentitySearch(query.term) : {})
    };

    return {
        visibility: PUBLIC_VISIBILITY,
        work: workFilters,
        ...(query.brazilianPublisherId
            ? { brazilianPublisherId: query.brazilianPublisherId }
            : {}),
        ...(query.formatId ? { formatId: query.formatId } : {}),
        ...(query.coverTypeId ? { coverTypeId: query.coverTypeId } : {}),
        ...(query.chronologicalNumber
            ? { chronologicalNumber: query.chronologicalNumber }
            : {}),
        ...(query.brazilPublicationStatus
            ? { brazilPublicationStatus: query.brazilPublicationStatus }
            : {})
    };
}

function buildPublicEditionDetailWhere(
    editionId: number,
    canViewAdultContent: boolean
): Prisma.EditionWhereInput {
    return {
        id: editionId,
        visibility: PUBLIC_VISIBILITY,
        work: {
            visibility: PUBLIC_VISIBILITY,
            ...buildAdultWorkRestriction(canViewAdultContent)
        }
    };
}

function buildPublicAuthorWorksWhere(
    authorId: number,
    canViewAdultContent: boolean
): Prisma.WorkWhereInput {
    return {
        visibility: PUBLIC_VISIBILITY,
        ...buildAdultWorkRestriction(canViewAdultContent),
        authors: { some: { authorId } }
    };
}

function buildPublicVolumeDetailWhere(
    volumeId: number,
    canViewAdultContent: boolean
): Prisma.VolumeWhereInput {
    return {
        id: volumeId,
        visibility: PUBLIC_VISIBILITY,
        edition: {
            visibility: PUBLIC_VISIBILITY,
            work: {
                visibility: PUBLIC_VISIBILITY,
                ...buildAdultWorkRestriction(canViewAdultContent)
            }
        }
    };
}

function buildPublicWorkOrderBy(
    sortBy: PublicWorksQuery['sortBy'] | PublicAuthorWorksQuery['sortBy'],
    order: PublicWorksQuery['order'] | PublicAuthorWorksQuery['order']
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
    romanizedTitle: true,
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
        orderBy: [
            { position: 'asc' as const },
            { authorId: 'asc' as const }
        ]
    }
} satisfies Prisma.WorkSelect;

const publicEditionCoverSourceSelect = {
    where: { number: EDITION_COVER_SOURCE_VOLUME_NUMBER, visibility: PUBLIC_VISIBILITY },
    take: 1,
    select: {
        coverAsset: {
            select: {
                objectKey: true,
                variants: {
                    select: { kind: true, objectKey: true }
                }
            }
        }
    }
} satisfies Prisma.Edition$volumesArgs;

const publicEditionSelect = {
    id: true,
    chronologicalNumber: true,
    // Capa derivada: somente o Volume 1 público desta Edição.
    volumes: publicEditionCoverSourceSelect,
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
                orderBy: [
                    { position: 'asc' as const },
                    { authorId: 'asc' as const }
                ]
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
    paper: {
        select: { id: true, label: true }
    },
    _count: {
        select: { volumes: { where: { visibility: PUBLIC_VISIBILITY } } }
    }
} satisfies Prisma.EditionSelect;

const PUBLIC_VOLUME_PREVIEW_LIMIT = 3;

const publicCoverAssetSelect = {
    objectKey: true,
    variants: {
        select: { kind: true, objectKey: true }
    }
} satisfies Prisma.MediaAssetSelect;

const publicWorkDetailSelect = {
    id: true,
    slug: true,
    title: true,
    originalTitle: true,
    romanizedTitle: true,
    synopsis: true,
    originalPublicationStartYear: true,
    originalPublicationEndYear: true,
    directRelease: true,
    country: true,
    originalPublicationStatus: true,
    coverAsset: { select: publicCoverAssetSelect },
    type: { select: { id: true, label: true } },
    authors: {
        select: {
            author: { select: { id: true, label: true } },
            roles: { select: { role: true }, orderBy: { role: 'asc' } }
        },
        orderBy: [{ position: 'asc' }, { authorId: 'asc' }]
    },
    genres: {
        select: { genre: { select: { id: true, label: true } } },
        orderBy: [{ genre: { position: 'asc' } }, { genre: { label: 'asc' } }]
    },
    demographics: {
        select: { demography: true },
        orderBy: { demography: 'asc' }
    },
    serializationMagazines: {
        select: { magazine: { select: { id: true, label: true } } },
        orderBy: [{ position: 'asc' }, { magazineId: 'asc' }]
    },
    originalPublishers: {
        select: { publisher: { select: { id: true, label: true } } },
        orderBy: [{ position: 'asc' }, { publisherId: 'asc' }]
    },
    editions: {
        where: { visibility: PUBLIC_VISIBILITY },
        orderBy: [{ chronologicalNumber: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            chronologicalNumber: true,
            brazilPublicationStatus: true,
            brazilianPublisher: { select: { id: true, label: true } },
            format: { select: { id: true, label: true } },
            coverType: { select: { id: true, label: true } },
            paper: { select: { id: true, label: true } },
            volumes: {
                where: { visibility: PUBLIC_VISIBILITY },
                orderBy: [{ number: 'asc' }, { id: 'asc' }],
                take: PUBLIC_VOLUME_PREVIEW_LIMIT,
                select: {
                    id: true,
                    number: true,
                    singleVolume: true,
                    releaseDatePrecision: true,
                    releaseYear: true,
                    releaseMonth: true,
                    releaseDay: true,
                    coverAsset: { select: publicCoverAssetSelect }
                }
            },
            _count: {
                select: {
                    volumes: { where: { visibility: PUBLIC_VISIBILITY } }
                }
            }
        }
    }
} satisfies Prisma.WorkSelect;

const publicEditionDetailSelect = {
    id: true,
    chronologicalNumber: true,
    brazilPublicationStatus: true,
    // Capa derivada: somente o Volume 1 público desta Edição.
    volumes: publicEditionCoverSourceSelect,
    brazilianPublisher: { select: { id: true, label: true } },
    format: { select: { id: true, label: true } },
    coverType: { select: { id: true, label: true } },
    paper: { select: { id: true, label: true } },
    work: {
        select: {
            id: true,
            slug: true,
            title: true,
            originalTitle: true,
            authors: {
                select: { author: { select: { id: true, label: true } } },
                orderBy: [{ position: 'asc' }, { authorId: 'asc' }]
            }
        }
    },
    _count: {
        select: {
            volumes: { where: { visibility: PUBLIC_VISIBILITY } }
        }
    }
} satisfies Prisma.EditionSelect;

const publicEditionVolumeSelect = {
    id: true,
    number: true,
    singleVolume: true,
    pages: true,
    releaseDatePrecision: true,
    releaseYear: true,
    releaseMonth: true,
    releaseDay: true,
    coverAsset: { select: publicCoverAssetSelect }
} satisfies Prisma.VolumeSelect;

const publicVolumeDetailSelect = {
    id: true,
    number: true,
    singleVolume: true,
    coverAsset: { select: publicCoverAssetSelect },
    pages: true,
    price: true,
    priceCurrency: true,
    releaseDatePrecision: true,
    releaseYear: true,
    releaseMonth: true,
    releaseDay: true,
    isbn10: true,
    isbn13: true,
    affiliateLink: true,
    synopsis: true,
    edition: {
        select: {
            id: true,
            chronologicalNumber: true,
            brazilianPublisher: { select: { id: true, label: true } },
            paper: { select: { id: true, label: true } },
            volumes: {
                where: { visibility: PUBLIC_VISIBILITY },
                orderBy: [{ number: 'asc' }, { id: 'asc' }],
                select: {
                    id: true,
                    number: true,
                    singleVolume: true
                }
            },
            work: {
                select: {
                    id: true,
                    slug: true,
                    title: true,
                    originalTitle: true
                }
            }
        }
    }
} satisfies Prisma.VolumeSelect;

// A Edição aninhada nos detalhes da Obra já usa "volumes" para a prévia paginada,
// por isso a capa derivada é buscada explicitamente pelo Volume 1 de cada Edição.
const publicEditionCoverSourceVolumeSelect = {
    editionId: true,
    coverAsset: { select: publicCoverAssetSelect }
} satisfies Prisma.VolumeSelect;

function buildPublicEditionCoverSourceWhere(editionIds: number[]): Prisma.VolumeWhereInput {
    return {
        editionId: { in: editionIds },
        number: EDITION_COVER_SOURCE_VOLUME_NUMBER,
        visibility: PUBLIC_VISIBILITY
    };
}

export {
    buildIdentitySearch,
    buildPublicEditionCoverSourceWhere,
    publicEditionCoverSourceVolumeSelect,
    buildPublicWorkWhere,
    buildPublicEditionWhere,
    buildPublicEditionDetailWhere,
    buildPublicAuthorWorksWhere,
    buildPublicVolumeDetailWhere,
    buildPublicWorkOrderBy,
    buildPublicEditionOrderBy,
    publicWorkSelect,
    publicEditionSelect,
    publicWorkDetailSelect,
    publicEditionDetailSelect,
    publicEditionVolumeSelect,
    publicVolumeDetailSelect,
    PUBLIC_VOLUME_PREVIEW_LIMIT
};
