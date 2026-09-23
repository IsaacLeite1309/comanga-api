
import { EDITION_COVER_SOURCE_VOLUME_NUMBER, WORK_SORT_FIELDS } from './constants';
import { normalizeWorkSummary } from './mappers';

function getWorkSummaryInclude() {
    return {
        coverAsset: {
            select: {
                id: true,
                objectKey: true,
                variants: {
                    select: { kind: true, objectKey: true }
                }
            }
        },
        _count: {
            select: {
                editions: true
            }
        },
        type: {
            select: { id: true, label: true }
        },
        authors: {
            select: {
                position: true,
                author: {
                    select: { id: true, label: true }
                },
                roles: {
                    select: { role: true }
                }
            },
            orderBy: [
                { position: 'asc' as const },
                { authorId: 'asc' as const }
            ]
        }
    };
}

function getEditionInclude() {
    return {
        work: {
            select: { id: true, slug: true, title: true }
        },
        // Origem única da capa derivada: o Volume de número 1 desta mesma Edição.
        volumes: {
            where: { number: EDITION_COVER_SOURCE_VOLUME_NUMBER },
            take: 1,
            select: {
                coverAsset: {
                    select: {
                        id: true,
                        objectKey: true,
                        variants: {
                            select: { kind: true, objectKey: true }
                        }
                    }
                }
            }
        },
        _count: {
            select: {
                volumes: true
            }
        },
        brazilianPublisher: {
            select: { id: true, label: true }
        },
        coverType: {
            select: { id: true, label: true }
        },
        format: {
            select: { id: true, label: true }
        },
        papers: {
            orderBy: [{ position: 'asc' as const }, { paper: { label: 'asc' as const } }],
            select: { paper: { select: { id: true, label: true } } }
        }
    };
}

function getWorkOrderBy(sortBy: typeof WORK_SORT_FIELDS[number], order: 'ASC' | 'DESC') {
    const direction = order.toLowerCase() as 'asc' | 'desc';

    if (sortBy === 'country') {
        return { country: direction };
    }

    if (sortBy === 'type') {
        return { type: { label: direction } };
    }

    if (sortBy === 'visibility') {
        return { visibility: direction };
    }

    return { title: direction };
}

function sortWorkSummariesInMemory(
    works: ReturnType<typeof normalizeWorkSummary>[],
    sortBy: typeof WORK_SORT_FIELDS[number],
    order: 'ASC' | 'DESC'
) {
    if (!['author', 'editions'].includes(sortBy)) return works;

    return [...works].sort((firstWork, secondWork) => {
        const firstValue = sortBy === 'author'
            ? firstWork.authors.map((author) => author?.label ?? '').join(', ')
            : String((firstWork as typeof firstWork & { editionsCount?: number }).editionsCount ?? 0).padStart(10, '0');
        const secondValue = sortBy === 'author'
            ? secondWork.authors.map((author) => author?.label ?? '').join(', ')
            : String((secondWork as typeof secondWork & { editionsCount?: number }).editionsCount ?? 0).padStart(10, '0');
        const comparison = firstValue.localeCompare(secondValue, 'pt-BR', { sensitivity: 'base' });

        return order === 'ASC' ? comparison : -comparison;
    });
}

function getWorkDetailInclude() {
    return {
        ...getWorkSummaryInclude(),
        originalPublishers: {
            select: {
                position: true,
                publisher: {
                    select: { id: true, label: true }
                }
            },
            orderBy: {
                position: 'asc' as const
            }
        },
        authors: {
            select: {
                position: true,
                author: {
                    select: { id: true, label: true }
                },
                roles: {
                    select: { role: true }
                }
            },
            orderBy: [
                { position: 'asc' as const },
                { authorId: 'asc' as const }
            ]
        },
        genres: {
            select: {
                genre: {
                    select: { id: true, label: true }
                }
            },
            orderBy: {
                genre: {
                    label: 'asc' as const
                }
            }
        },
        demographics: {
            select: {
                demography: true
            },
            orderBy: {
                demography: 'asc' as const
            }
        },
        serializationMagazines: {
            select: {
                position: true,
                magazine: {
                    select: { id: true, label: true }
                }
            },
            orderBy: {
                position: 'asc' as const
            }
        }
    };
}

export {
    getWorkSummaryInclude,
    getEditionInclude,
    getWorkOrderBy,
    sortWorkSummariesInMemory,
    getWorkDetailInclude
};
