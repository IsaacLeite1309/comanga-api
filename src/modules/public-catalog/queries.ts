import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { PUBLIC_VISIBILITY } from './constants';
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

function buildPublicEditionDetailWhere(
    editionId: number,
    canViewAdultContent: boolean
): Prisma.EditionWhereInput {
    return {
        id: editionId,
        visibility: PUBLIC_VISIBILITY,
        work: {
            visibility: PUBLIC_VISIBILITY,
            ...(!canViewAdultContent ? { adultContent: false } : {})
        }
    };
}

function buildPublicAuthorWorksWhere(
    authorId: number,
    canViewAdultContent: boolean
): Prisma.WorkWhereInput {
    return {
        visibility: PUBLIC_VISIBILITY,
        ...(!canViewAdultContent ? { adultContent: false } : {}),
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
                ...(!canViewAdultContent ? { adultContent: false } : {})
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
    originalPublicationStartYear: true,
    originalPublicationEndYear: true,
    originalVolumeCount: true,
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
        orderBy: { author: { label: 'asc' } }
    },
    genres: {
        select: { genre: { select: { id: true, label: true } } },
        orderBy: { genre: { label: 'asc' } }
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
            coverAsset: { select: publicCoverAssetSelect },
            brazilianPublisher: { select: { id: true, label: true } },
            editionType: { select: { id: true, label: true } },
            format: { select: { id: true, label: true } },
            coverType: { select: { id: true, label: true } },
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
    coverAsset: { select: publicCoverAssetSelect },
    brazilianPublisher: { select: { id: true, label: true } },
    editionType: { select: { id: true, label: true } },
    format: { select: { id: true, label: true } },
    coverType: { select: { id: true, label: true } },
    work: {
        select: {
            id: true,
            slug: true,
            title: true,
            originalTitle: true,
            authors: {
                select: { author: { select: { id: true, label: true } } },
                orderBy: { author: { label: 'asc' } }
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

export {
    buildIdentitySearch,
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
