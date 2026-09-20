import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import prisma from '../../../prisma';
import {
    COUNTRY_DEPENDENT_CATEGORY_SLUGS,
    EDITION_FORM_OPTION_CATEGORIES,
    WORK_FORM_OPTION_CATEGORIES
} from '../../catalog';
import {
    isReorderableOptionCategory,
    isSystemManagedOptionCategory
} from '../../../utils/domainOptionCodes';
import {
    DUPLICATE_OPTION_MESSAGE,
    INVALID_REORDER_VALUES_MESSAGE,
    NOT_REORDERABLE_CATEGORY_MESSAGE,
    OPTION_IN_USE_MESSAGE,
    SYSTEM_MANAGED_CREATE_MESSAGE,
    SYSTEM_MANAGED_DELETE_MESSAGE,
    SYSTEM_MANAGED_UPDATE_MESSAGE
} from './constants';
import { normalizeOptionValue } from './mappers';
import {
    categoryParamSchema,
    createOptionSchema,
    listOptionsQuerySchema,
    reorderOptionsSchema,
    updateOptionSchema
} from './schemas';
import {
    findCategoryBySlug,
    findDuplicateSubmittedLabels,
    findExistingOptionLabels,
    findListableCategoryBySlug,
    formatExistingDuplicateMessage,
    formatSubmittedDuplicateMessage,
    isManageableOptionCategory,
    optionLabelExists,
    parseOptionLabelsForCategory,
    validateCountryDependencies
} from './services';
import { buildFormOptionQuery, buildOptionValueOrderBy, getOptionValueSelect } from './queries';

interface PrismaKnownError {
    code?: string;
}

async function getWorkFormOptions(_req: Request, res: Response, next: NextFunction) {
    try {
        const [
            authors,
            workTypes,
            genres,
            magazines,
            originalPublishers
        ] = await prisma.$transaction([
            buildFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.authors),
            buildFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.workTypes),
            buildFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.genres),
            buildFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.magazines),
            buildFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.originalPublishers)
        ]);

        return res.status(200).json({
            options: {
                authors: authors.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                workTypes: workTypes.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                genres: genres.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                magazines: magazines.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                originalPublishers: originalPublishers.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                ))
            }
        });

    } catch (error) {
        return next(error);
    }
}

async function getEditionFormOptions(_req: Request, res: Response, next: NextFunction) {
    try {
        const [
            brazilianPublishers,
            editionTypes,
            coverTypes,
            formats
        ] = await prisma.$transaction([
            buildFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.brazilianPublishers),
            buildFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.editionTypes),
            buildFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.coverTypes),
            buildFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.formats)
        ]);

        return res.status(200).json({
            options: {
                brazilianPublishers: brazilianPublishers.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                editionTypes: editionTypes.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                coverTypes: coverTypes.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                formats: formats.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                ))
            }
        });

    } catch (error) {
        return next(error);
    }
}

async function listOptions(req: Request, res: Response, next: NextFunction) {
    const paramsValidation = categoryParamSchema.safeParse(req.params);
    const queryValidation = listOptionsQuerySchema.safeParse(req.query);

    if (!paramsValidation.success) {
        return res.status(400).json({ error: 'Categoria obrigatória.' });
    }

    if (!queryValidation.success) {
        return res.status(400).json({ error: 'Filtros de consulta inválidos.' });
    }

    const { term, dependsOn, includeInactive, order, page, limit } = queryValidation.data;

    try {
        const category = await findListableCategoryBySlug(paramsValidation.data.category);

        if (!category) {
            return res.status(404).json({ error: 'Categoria não encontrada.' });
        }

        const where = {
            categoryId: category.id,
            // Valores inativos só aparecem sob demanda, para permitir reativá-los.
            ...(includeInactive ? {} : { active: true }),
            ...(dependsOn
                ? {
                    dependencies: {
                        some: {
                            dependsOnValueId: dependsOn
                        }
                    }
                }
                : {}),
            ...(term
                ? {
                    label: {
                        contains: term,
                        mode: 'insensitive' as const
                    }
                }
                : {})
        };
        const shouldSelectDependencies = COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(category.slug);

        const [values, total] = await prisma.$transaction([
            prisma.domainOptionValue.findMany({
                where,
                select: getOptionValueSelect(shouldSelectDependencies),
                orderBy: buildOptionValueOrderBy(category.slug, order.toLowerCase() as 'asc' | 'desc'),
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.domainOptionValue.count({ where })
        ]);

        return res.status(200).json({
            category: {
                slug: category.slug,
                name: category.name
            },
            values: values.map((value) => normalizeOptionValue(
                value as unknown as Parameters<typeof normalizeOptionValue>[0]
            )),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        return next(error);
    }
}

async function createOption(req: Request, res: Response, next: NextFunction) {
    const validation = createOptionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Categoria e texto do valor são obrigatórios.' });
    }

    const { category: categorySlug, label, dependsOnValueIds } = validation.data;

    try {
        const category = await findCategoryBySlug(categorySlug);

        if (!category) {
            return res.status(404).json({ error: 'Categoria não encontrada.' });
        }

        if (isSystemManagedOptionCategory(category.slug)) {
            return res.status(403).json({ error: SYSTEM_MANAGED_CREATE_MESSAGE });
        }

        const labels = parseOptionLabelsForCategory(label, category.slug);

        if (labels.length === 0) {
            return res.status(400).json({ error: 'Informe ao menos um valor válido.' });
        }

        const duplicatedSubmittedLabels = findDuplicateSubmittedLabels(labels);

        if (duplicatedSubmittedLabels.length > 0) {
            return res.status(400).json({ error: formatSubmittedDuplicateMessage(duplicatedSubmittedLabels) });
        }

        const existingLabels = await findExistingOptionLabels(category.id, labels);

        if (existingLabels.length > 0) {
            return res.status(409).json({ error: formatExistingDuplicateMessage(existingLabels) });
        }

        const dependencyValidation = await validateCountryDependencies(category.slug, dependsOnValueIds);

        if ('error' in dependencyValidation) {
            return res.status(400).json({ error: dependencyValidation.error });
        }

        const shouldSelectDependencies = COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(category.slug);
        const values = await prisma.$transaction(async (tx) => {
            const createdValues = [];

            for (const itemLabel of labels) {
                const createdValue = await tx.domainOptionValue.create({
                    data: {
                        categoryId: category.id,
                        label: itemLabel
                    },
                    select: getOptionValueSelect(false)
                });

                if (dependencyValidation.length > 0) {
                    await tx.domainOptionValueDependency.createMany({
                        data: dependencyValidation.map((dependsOnValueId) => ({
                            dependentValueId: createdValue.id,
                            dependsOnValueId
                        }))
                    });
                }

                if (!shouldSelectDependencies) {
                    createdValues.push(createdValue);
                    continue;
                }

                const valueWithDependencies = await tx.domainOptionValue.findUniqueOrThrow({
                    where: { id: createdValue.id },
                    select: getOptionValueSelect(true)
                });

                createdValues.push(valueWithDependencies);
            }

            return createdValues;
        });
        const normalizedValues = values.map((value) => normalizeOptionValue(
            value as unknown as Parameters<typeof normalizeOptionValue>[0]
        ));

        return res.status(201).json({
            value: normalizedValues[0],
            values: normalizedValues
        });

    } catch (error) {
        return next(error);
    }
}

async function findOptionForUpdate(optionId: number) {
    return prisma.domainOptionValue.findUnique({
        where: { id: optionId },
        select: {
            id: true,
            categoryId: true,
            systemManaged: true,
            category: {
                select: {
                    slug: true
                }
            }
        }
    });
}

// Valor controlado pelo sistema aceita apenas ativação/desativação (decisão 4).
function changesControlledFields(data: z.infer<typeof updateOptionSchema>) {
    return data.label !== undefined || data.dependsOnValueIds !== undefined;
}

function buildOptionUpdateData(data: z.infer<typeof updateOptionSchema>) {
    return {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.active !== undefined ? { active: data.active } : {})
    };
}

async function persistOptionUpdate(
    optionId: number,
    categorySlug: string,
    data: z.infer<typeof updateOptionSchema>,
    dependencyIds: number[] | undefined
) {
    const shouldSelectDependencies = COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(categorySlug);

    return prisma.$transaction(async (tx) => {
        const updatedValue = await tx.domainOptionValue.update({
            where: { id: optionId },
            data: buildOptionUpdateData(data),
            select: getOptionValueSelect(false)
        });

        if (dependencyIds) {
            await tx.domainOptionValueDependency.deleteMany({
                where: { dependentValueId: optionId }
            });

            if (dependencyIds.length > 0) {
                await tx.domainOptionValueDependency.createMany({
                    data: dependencyIds.map((dependsOnValueId) => ({
                        dependentValueId: optionId,
                        dependsOnValueId
                    }))
                });
            }
        }

        if (!shouldSelectDependencies) {
            return updatedValue;
        }

        return tx.domainOptionValue.findUniqueOrThrow({
            where: { id: optionId },
            select: getOptionValueSelect(true)
        });
    });
}

function isControlledValue(value: { systemManaged: boolean; category: { slug: string } }) {
    return value.systemManaged || isSystemManagedOptionCategory(value.category.slug);
}

async function updateOption(req: Request, res: Response, next: NextFunction) {
    const validation = updateOptionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Texto do novo valor é obrigatório.' });
    }

    if (Object.keys(validation.data).length === 0) {
        return res.status(400).json({ error: 'Informe ao menos um campo para alterar.' });
    }

    const optionId = Number(req.params.id);

    if (!Number.isInteger(optionId) || optionId <= 0) {
        return res.status(400).json({ error: 'Formato de identificador inválido.' });
    }

    try {
        const currentValue = await findOptionForUpdate(optionId);

        if (!currentValue || !isManageableOptionCategory(currentValue.category.slug)) {
            return res.status(404).json({ error: 'Valor não encontrado.' });
        }

        if (isControlledValue(currentValue)
            && changesControlledFields(validation.data)) {
            return res.status(403).json({ error: SYSTEM_MANAGED_UPDATE_MESSAGE });
        }

        const newLabel = validation.data.label;

        if (newLabel !== undefined && await optionLabelExists(currentValue.categoryId, newLabel, optionId)) {
            return res.status(409).json({ error: DUPLICATE_OPTION_MESSAGE });
        }

        const dependencyIds = validation.data.dependsOnValueIds;
        let dependencyValidation: number[] | { error: string } = [];

        if (dependencyIds) {
            dependencyValidation = await validateCountryDependencies(currentValue.category.slug, dependencyIds);

            if ('error' in dependencyValidation) {
                return res.status(400).json({ error: dependencyValidation.error });
            }
        }

        const value = await persistOptionUpdate(
            optionId,
            currentValue.category.slug,
            validation.data,
            dependencyIds ? dependencyValidation as number[] : undefined
        );

        return res.status(200).json({
            value: normalizeOptionValue(value as unknown as Parameters<typeof normalizeOptionValue>[0])
        });

    } catch (error) {
        return next(error);
    }
}

async function deleteOption(req: Request, res: Response, next: NextFunction) {
    const optionId = Number(req.params.id);

    if (!Number.isInteger(optionId) || optionId <= 0) {
        return res.status(400).json({ error: 'Formato de identificador inválido.' });
    }

    try {
        const currentValue = await prisma.domainOptionValue.findUnique({
            where: { id: optionId },
            select: {
                systemManaged: true,
                category: {
                    select: { slug: true }
                }
            }
        });

        if (!currentValue || !isManageableOptionCategory(currentValue.category.slug)) {
            return res.status(404).json({ error: 'Valor não encontrado.' });
        }

        if (isControlledValue(currentValue)) {
            return res.status(403).json({ error: SYSTEM_MANAGED_DELETE_MESSAGE });
        }

        await prisma.domainOptionValue.delete({
            where: { id: optionId }
        });

        return res.status(200).json({ message: 'Valor excluído com sucesso.' });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2025') {
            return res.status(404).json({ error: 'Valor não encontrado.' });
        }

        if (knownError.code === 'P2003') {
            return res.status(409).json({ error: OPTION_IN_USE_MESSAGE });
        }

        return next(error);
    }
}

// Normaliza as posições da categoria para 0..n-1 pela ordem recebida. Ids repetidos
// são reduzidos à primeira ocorrência e os valores não citados ficam no fim,
// preservando a ordem relativa anterior (decisão 3 do brief).
function buildNormalizedOrder(requestedIds: number[], currentIds: number[]) {
    const requested = [...new Set(requestedIds)];
    const requestedSet = new Set(requested);

    return [...requested, ...currentIds.filter((id) => !requestedSet.has(id))];
}

async function reorderOptions(req: Request, res: Response, next: NextFunction) {
    const paramsValidation = categoryParamSchema.safeParse(req.params);
    const bodyValidation = reorderOptionsSchema.safeParse(req.body);

    if (!paramsValidation.success) {
        return res.status(400).json({ error: 'Categoria obrigatória.' });
    }

    if (!bodyValidation.success) {
        return res.status(400).json({ error: 'Informe a nova ordem dos valores.' });
    }

    const categorySlug = paramsValidation.data.category;

    if (!isReorderableOptionCategory(categorySlug)) {
        return res.status(400).json({ error: NOT_REORDERABLE_CATEGORY_MESSAGE });
    }

    try {
        const category = await findCategoryBySlug(categorySlug);

        if (!category) {
            return res.status(404).json({ error: 'Categoria não encontrada.' });
        }

        const currentValues = await prisma.domainOptionValue.findMany({
            where: { categoryId: category.id },
            select: { id: true },
            orderBy: buildOptionValueOrderBy(category.slug, 'asc')
        });
        const currentIds = currentValues.map((value) => value.id);
        const knownIds = new Set(currentIds);

        if (bodyValidation.data.valueIds.some((id) => !knownIds.has(id))) {
            return res.status(400).json({ error: INVALID_REORDER_VALUES_MESSAGE });
        }

        const orderedIds = buildNormalizedOrder(bodyValidation.data.valueIds, currentIds);
        const values = await prisma.$transaction(async (tx) => {
            for (const [position, id] of orderedIds.entries()) {
                await tx.domainOptionValue.update({ where: { id }, data: { position } });
            }

            return tx.domainOptionValue.findMany({
                where: { categoryId: category.id },
                select: getOptionValueSelect(false),
                orderBy: buildOptionValueOrderBy(category.slug, 'asc')
            });
        });

        return res.status(200).json({
            category: { slug: category.slug, name: category.name },
            values: values.map((value) => normalizeOptionValue(
                value as unknown as Parameters<typeof normalizeOptionValue>[0]
            ))
        });

    } catch (error) {
        return next(error);
    }
}

export {
    getWorkFormOptions,
    getEditionFormOptions,
    listOptions,
    createOption,
    updateOption,
    deleteOption,
    reorderOptions
};
