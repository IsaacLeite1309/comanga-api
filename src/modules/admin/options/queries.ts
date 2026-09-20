import prisma from '../../../prisma';
import { COUNTRY_DEPENDENT_CATEGORY_SLUGS } from '../../catalog';

function getOptionValueSelect(includeDependencies: boolean) {
    return {
        id: true,
        label: true,
        category: {
            select: { slug: true, name: true }
        },
        ...(includeDependencies
            ? {
                dependencies: {
                    select: {
                        dependsOnValue: {
                            select: {
                                id: true,
                                label: true,
                                category: { select: { slug: true, name: true } }
                            }
                        }
                    },
                    orderBy: { dependsOnValue: { label: 'asc' as const } }
                }
            }
            : {})
    };
}

function buildFormOptionQuery(categorySlug: string) {
    return prisma.domainOptionValue.findMany({
        where: {
            active: true,
            category: { slug: categorySlug }
        },
        select: getOptionValueSelect(COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(categorySlug)),
        orderBy: { label: 'asc' }
    });
}

export { buildFormOptionQuery, getOptionValueSelect };
