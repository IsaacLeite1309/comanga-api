import prisma from '../../prisma';
import { COUNTRY_DEPENDENT_CATEGORY_SLUGS, WORK_SORT_FIELDS } from './constants';
import { normalizeWorkSummary } from './mappers';

function getOptionValueSelect(includeDependencies: boolean) {
    return {
        id: true,
        label: true,
        category: {
            select: {
                slug: true,
                name: true
            }
        },
        ...(includeDependencies
            ? {
                dependencies: {
                    select: {
                        dependsOnValue: {
                            select: {
                                id: true,
                                label: true,
                                category: {
                                    select: {
                                        slug: true,
                                        name: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        dependsOnValue: {
                            label: 'asc' as const
                        }
                    }
                }
            }
            : {})
    };
}

function getWorkSummaryInclude() {
    return {
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
                author: {
                    select: { id: true, label: true }
                },
                roles: {
                    select: { role: true }
                }
            },
            orderBy: {
                author: {
                    label: 'asc' as const
                }
            }
        }
    };
}

function getEditionInclude() {
    return {
        _count: {
            select: {
                volumes: true
            }
        },
        brazilianPublisher: {
            select: { id: true, label: true }
        },
        editionType: {
            select: { id: true, label: true }
        },
        coverType: {
            select: { id: true, label: true }
        },
        format: {
            select: { id: true, label: true }
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

function buildWorkFormOptionQuery(categorySlug: string) {
    return prisma.domainOptionValue.findMany({
        where: {
            active: true,
            category: {
                slug: categorySlug
            }
        },
        select: getOptionValueSelect(COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(categorySlug)),
        orderBy: {
            label: 'asc'
        }
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
                author: {
                    select: { id: true, label: true }
                },
                roles: {
                    select: { role: true }
                }
            },
            orderBy: {
                author: {
                    label: 'asc' as const
                }
            }
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
    getOptionValueSelect,
    getWorkSummaryInclude,
    getEditionInclude,
    getWorkOrderBy,
    sortWorkSummariesInMemory,
    buildWorkFormOptionQuery,
    getWorkDetailInclude
};
