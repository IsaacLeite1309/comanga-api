import type { NextFunction, Request, Response } from 'express';
import prisma from '../../../prisma';
import {
    DUPLICATE_OPTION_MESSAGE,
    OPTION_IN_USE_MESSAGE,
    WORK_FORM_OPTION_CATEGORIES,
    EDITION_FORM_OPTION_CATEGORIES,
    COUNTRY_DEPENDENT_CATEGORY_SLUGS,
    PrismaKnownError,
    normalizeOptionValue,
    categoryParamSchema,
    listOptionsQuerySchema,
    createOptionSchema,
    updateOptionSchema,
    findCategoryBySlug,
    optionLabelExists,
    parseOptionLabelsForCategory,
    findDuplicateSubmittedLabels,
    findExistingOptionLabels,
    formatSubmittedDuplicateMessage,
    formatExistingDuplicateMessage,
    validateCountryDependencies,
    getOptionValueSelect,
    buildWorkFormOptionQuery
} from '../shared';

async function getWorkFormOptions(_req: Request, res: Response, next: NextFunction) {
    try {
        const [
            authors,
            workTypes,
            genres,
            magazines,
            originalPublishers
        ] = await prisma.$transaction([
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.authors),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.workTypes),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.genres),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.magazines),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.originalPublishers)
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
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.brazilianPublishers),
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.editionTypes),
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.coverTypes),
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.formats)
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

    const { term, dependsOn, order, page, limit } = queryValidation.data;

    try {
        const category = await findCategoryBySlug(paramsValidation.data.category);

        if (!category) {
            return res.status(404).json({ error: 'Categoria não encontrada.' });
        }

        const where = {
            categoryId: category.id,
            active: true,
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
                orderBy: {
                    label: order.toLowerCase() as 'asc' | 'desc'
                },
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

async function updateOption(req: Request, res: Response, next: NextFunction) {
    const validation = updateOptionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Texto do novo valor é obrigatório.' });
    }

    const optionId = Number(req.params.id);

    if (!Number.isInteger(optionId) || optionId <= 0) {
        return res.status(400).json({ error: 'Formato de identificador inválido.' });
    }

    try {
        const currentValue = await prisma.domainOptionValue.findUnique({
            where: { id: optionId },
            select: {
                id: true,
                categoryId: true,
                category: {
                    select: {
                        slug: true
                    }
                }
            }
        });

        if (!currentValue) {
            return res.status(404).json({ error: 'Valor não encontrado.' });
        }

        if (await optionLabelExists(currentValue.categoryId, validation.data.label, optionId)) {
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

        const shouldSelectDependencies = COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(currentValue.category.slug);
        const value = await prisma.$transaction(async (tx) => {
            const updatedValue = await tx.domainOptionValue.update({
                where: { id: optionId },
                data: {
                    label: validation.data.label
                },
                select: getOptionValueSelect(false)
            });

            if (dependencyIds) {
                await tx.domainOptionValueDependency.deleteMany({
                    where: { dependentValueId: optionId }
                });

                if (dependencyValidation.length > 0) {
                    await tx.domainOptionValueDependency.createMany({
                        data: dependencyValidation.map((dependsOnValueId) => ({
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


export = {
    getWorkFormOptions,
    getEditionFormOptions,
    listOptions,
    createOption,
    updateOption,
    deleteOption
};

