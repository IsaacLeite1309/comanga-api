import prisma from '../../../prisma';
import { isOrderedOptionCategory, isSystemManagedOptionCategory } from '../../../utils/domainOptionCodes';

function getOptionValueSelect() {
    return {
        id: true,
        label: true,
        code: true,
        systemManaged: true,
        position: true,
        active: true,
        category: {
            select: { slug: true, name: true }
        }
    };
}

function buildFormOptionQuery(categorySlug: string) {
    return prisma.domainOptionValue.findMany({
        where: {
            active: true,
            ...(isSystemManagedOptionCategory(categorySlug) ? { systemManaged: true } : {}),
            category: { slug: categorySlug }
        },
        select: getOptionValueSelect(),
        orderBy: buildOptionValueOrderBy(categorySlug, 'asc')
    });
}

// Em gêneros e tipos de Obra a posição manda; o rótulo é só desempate determinístico.
function buildOptionValueOrderBy(categorySlug: string, direction: 'asc' | 'desc') {
    if (!isOrderedOptionCategory(categorySlug)) {
        return [{ label: direction }, { id: 'asc' as const }];
    }

    return [{ position: direction }, { label: direction }, { id: 'asc' as const }];
}

export { buildFormOptionQuery, buildOptionValueOrderBy, getOptionValueSelect };
