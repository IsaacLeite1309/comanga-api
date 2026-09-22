import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../../prisma';
import { createUniqueWorkSlug } from './workSlug';
import {
    activateCoverAsset,
    deleteOrphanedCoverAsset,
    isCoverAssetAttachable
} from '../../media';
import {
    AUTHOR_DUPLICATED_MESSAGE,
    WORK_DUPLICATED_MESSAGE,
    REQUIRED_WORK_FIELDS_MESSAGE,
    INVALID_DOMAIN_REFERENCE_MESSAGE,
    WORK_DOMAIN_CATEGORIES,
    WORK_WITH_EDITIONS_DELETE_MESSAGE,
    PrismaKnownError,
    WorkDetailInput,
    hasDuplicatedStrings,
    isPublicVisibility,
    normalizeVisibility,
    normalizeWorkSummary,
    normalizeWorkDetail,
    normalizeOrderedIds,
    normalizeOrderedAuthors,
    getOrderedIds,
    findDuplicatedNumbers,
    validateOptionIdsByCategory,
    validateWorkDomainReferences,
    createWorkSchema,
    updateWorkSchema,
    updateWorkVisibilitySchema,
    listWorksQuerySchema,
    validateSelectedOptionsByCountry,
    getWorkSummaryInclude,
    getWorkOrderBy,
    sortWorkSummariesInMemory,
    getWorkDetailInclude,
    parsePositiveId
} from '../shared';

type CreateWorkData = z.infer<typeof createWorkSchema>;

function prepareCreateWorkRelations(data: CreateWorkData) {
    const demographies = data.directRelease ? [] : data.demographies;
    const orderedMagazines = data.directRelease ? [] : normalizeOrderedIds(data.magazineIds);
    const orderedOriginalPublishers = normalizeOrderedIds(data.originalPublisherIds);
    return {
        demographies,
        orderedMagazines,
        orderedOriginalPublishers,
        magazineIds: getOrderedIds(orderedMagazines),
        originalPublisherIds: getOrderedIds(orderedOriginalPublishers)
    };
}

function hasInvalidPublicationPeriod(data: {
    originalPublicationStartYear?: number | null;
    originalPublicationEndYear?: number | null;
}) {
    return Boolean(
        data.originalPublicationStartYear
        && data.originalPublicationEndYear
        && data.originalPublicationEndYear < data.originalPublicationStartYear
    );
}

function hasDuplicatedWorkRelations(
    data: {
        genreIds?: number[];
        authors?: Array<{ roles: string[] }>;
    },
    demographies: string[] | undefined,
    magazineIds: number[] | undefined,
    originalPublisherIds: number[] | undefined
) {
    return Boolean(
        (data.genreIds && findDuplicatedNumbers(data.genreIds).length > 0)
        || (demographies && hasDuplicatedStrings(demographies))
        || (magazineIds && findDuplicatedNumbers(magazineIds).length > 0)
        || (originalPublisherIds && findDuplicatedNumbers(originalPublisherIds).length > 0)
        || (data.authors && data.authors.some((author) => hasDuplicatedStrings(author.roles)))
    );
}

function getCreateWorkValidationError(
    data: CreateWorkData,
    relations: ReturnType<typeof prepareCreateWorkRelations>
) {
    const duplicatedAuthors = findDuplicatedNumbers(data.authors.map((author) => author.authorId));
    if (duplicatedAuthors.length > 0) return AUTHOR_DUPLICATED_MESSAGE;
    if (hasDuplicatedWorkRelations(data, relations.demographies, relations.magazineIds, relations.originalPublisherIds)) {
        return 'Valores duplicados nos vinculos da Obra.';
    }
    if (hasInvalidPublicationPeriod(data)) {
        return 'O fim da publicação original não pode ser anterior ao início.';
    }
    return undefined;
}

async function getCreateWorkDependencyError(
    data: CreateWorkData,
    relations: ReturnType<typeof prepareCreateWorkRelations>
) {
    const duplicatedWork = await prisma.work.findFirst({
        where: { title: { equals: data.title, mode: 'insensitive' } },
        select: { id: true }
    });
    if (duplicatedWork) return { status: 409, error: WORK_DUPLICATED_MESSAGE };

    const referencesAreValid = await validateWorkDomainReferences({
        ...data,
        originalPublisherIds: relations.originalPublisherIds,
        magazineIds: relations.magazineIds
    });
    if (!referencesAreValid) return { status: 400, error: INVALID_DOMAIN_REFERENCE_MESSAGE };
    if (data.coverAssetId && !await isCoverAssetAttachable(data.coverAssetId)) {
        return { status: 400, error: 'A capa interna informada é inválida ou já está em uso.' };
    }
    return undefined;
}

function buildCreateWorkData(
    data: CreateWorkData,
    relations: ReturnType<typeof prepareCreateWorkRelations>,
    slug: string
) {
    return {
        slug,
        title: data.title,
        originalTitle: data.originalTitle || null,
        romanizedTitle: data.romanizedTitle,
        synopsis: data.synopsis,
        originalPublicationStartYear: data.originalPublicationStartYear || null,
        originalPublicationEndYear: data.originalPublicationEndYear || null,
        directRelease: data.directRelease,
        typeId: data.typeId,
        country: data.country,
        originalPublicationStatus: data.originalPublicationStatus,
        coverAssetId: data.coverAssetId,
        adultContent: data.adultContent,
        visibility: 'Privado',
        authors: {
            createMany: {
                data: normalizeOrderedAuthors(data.authors).map(({ authorId, position }) => ({ authorId, position }))
            }
        },
        genres: { createMany: { data: data.genreIds.map((genreId) => ({ genreId })) } },
        demographics: {
            createMany: { data: relations.demographies.map((demography) => ({ demography })) }
        },
        serializationMagazines: {
            createMany: {
                data: relations.orderedMagazines.map(({ id, position }) => ({ magazineId: id, position }))
            }
        },
        originalPublishers: {
            createMany: {
                data: relations.orderedOriginalPublishers.map(({ id, position }) => ({ publisherId: id, position }))
            }
        }
    };
}

async function persistCreatedWork(
    data: CreateWorkData,
    relations: ReturnType<typeof prepareCreateWorkRelations>,
    slug: string
) {
    return prisma.$transaction(async (tx) => {
        const createdWork = await tx.work.create({ data: buildCreateWorkData(data, relations, slug) });
        await tx.workAuthorRole.createMany({
            data: data.authors.flatMap((author) => author.roles.map((role) => ({
                workId: createdWork.id,
                authorId: author.authorId,
                role
            })))
        });
        if (data.coverAssetId) await activateCoverAsset(tx, data.coverAssetId);
        return createdWork.id;
    });
}

async function createWork(req: Request, res: Response, next: NextFunction) {
    const validation = createWorkSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: REQUIRED_WORK_FIELDS_MESSAGE });
    const data = validation.data;
    const relations = prepareCreateWorkRelations(data);
    const validationError = getCreateWorkValidationError(data, relations);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
        const dependencyError = await getCreateWorkDependencyError(data, relations);
        if (dependencyError) return res.status(dependencyError.status).json({ error: dependencyError.error });
        const slug = await createUniqueWorkSlug(data.title, prisma.work);
        const workId = await persistCreatedWork(data, relations, slug);
        const work = await prisma.work.findUniqueOrThrow({
            where: { id: workId },
            include: getWorkDetailInclude()
        });
        return res.status(201).json({
            work: normalizeWorkDetail(work as unknown as WorkDetailInput)
        });
    } catch (error) {
        const knownError = error as PrismaKnownError;
        if (knownError.code === 'P2002') return res.status(409).json({ error: WORK_DUPLICATED_MESSAGE });
        return next(error);
    }
}

async function listWorks(req: Request, res: Response, next: NextFunction) {
    const validation = listWorksQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: 'Filtros de consulta inválidos.' });
    }

    const { term, typeId, country, visibility, sortBy, order, page, limit } = validation.data;
    const where = {
        ...(term
            ? {
                title: {
                    contains: term,
                    mode: 'insensitive' as const
                }
            }
            : {}),
        ...(typeId ? { typeId } : {}),
        ...(country ? { country } : {}),
        ...(visibility ? { visibility } : {})
    };

    try {
        const [works, total] = await prisma.$transaction([
            prisma.work.findMany({
                where,
                include: getWorkSummaryInclude(),
                orderBy: getWorkOrderBy(sortBy, order),
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.work.count({ where })
        ]);

        return res.status(200).json({
            works: sortWorkSummariesInMemory(works.map(normalizeWorkSummary), sortBy, order),
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

async function getWorkById(req: Request, res: Response, next: NextFunction) {
    const workId = Number(req.params.id);

    if (!Number.isInteger(workId) || workId <= 0) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            include: getWorkDetailInclude()
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        return res.status(200).json({
            work: normalizeWorkDetail(work as unknown as WorkDetailInput)
        });

    } catch (error) {
        return next(error);
    }
}

async function getWorkBySlug(req: Request, res: Response, next: NextFunction) {
    const slugParam = req.params.slug;
    const slug = (Array.isArray(slugParam) ? slugParam[0] : slugParam)?.trim().toLowerCase();

    if (!slug || slug.length > 255 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return res.status(400).json({ error: 'Formato de slug inválido.' });
    }

    try {
        const work = await prisma.work.findUnique({
            where: { slug },
            include: getWorkDetailInclude()
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        return res.status(200).json({
            work: normalizeWorkDetail(work as unknown as WorkDetailInput)
        });
    } catch (error) {
        return next(error);
    }
}

async function validatePartialWorkDomainReferences(
    data: z.infer<typeof updateWorkSchema>,
    currentWork?: {
        country: string;
        typeId: number;
        authors: Array<{ authorId: number }>;
        originalPublishers: Array<{ publisherId: number }>;
        serializationMagazines: Array<{ magazineId: number }>;
    }
) {
    const validations: Array<Promise<boolean>> = [];

    if (data.typeId) {
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.typeId, [data.typeId]));
    }

    if (data.originalPublisherIds && data.originalPublisherIds.length > 0) {
        const originalPublisherIds = getOrderedIds(normalizeOrderedIds(data.originalPublisherIds));
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.originalPublishers, originalPublisherIds));
    }

    if (data.authors) {
        validations.push(validateOptionIdsByCategory(
            WORK_DOMAIN_CATEGORIES.authorId,
            data.authors.map((author) => author.authorId)
        ));
    }

    if (data.genreIds) {
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.genreIds, data.genreIds));
    }

    if (data.magazineIds) {
        const magazineIds = getOrderedIds(normalizeOrderedIds(data.magazineIds));
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.magazineIds, magazineIds));
    }

    const results = await Promise.all(validations);
    if (!results.every(Boolean)) {
        return false;
    }

    if (!currentWork) {
        return true;
    }

    const country = data.country || currentWork.country;
    const typeIds = data.typeId ? [data.typeId] : [currentWork.typeId];
    const authorIds = data.authors
        ? data.authors.map((author) => author.authorId)
        : currentWork.authors.map((author) => author.authorId);
    const originalPublisherIds = data.originalPublisherIds !== undefined
        ? getOrderedIds(normalizeOrderedIds(data.originalPublisherIds))
        : currentWork.originalPublishers.map((publisher) => publisher.publisherId);
    const magazineIds = data.magazineIds
        ? getOrderedIds(normalizeOrderedIds(data.magazineIds))
        : currentWork.serializationMagazines.map((magazine) => magazine.magazineId);

    return validateSelectedOptionsByCountry([
        { categorySlug: WORK_DOMAIN_CATEGORIES.typeId, ids: typeIds },
        { categorySlug: WORK_DOMAIN_CATEGORIES.authorId, ids: authorIds },
        { categorySlug: WORK_DOMAIN_CATEGORIES.originalPublishers, ids: originalPublisherIds },
        { categorySlug: WORK_DOMAIN_CATEGORIES.magazineIds, ids: magazineIds }
    ], country);
}

type UpdateWorkData = z.infer<typeof updateWorkSchema>;

function prepareUpdateWorkRelations(data: UpdateWorkData) {
    const orderedOriginalPublishers = data.originalPublisherIds === undefined
        ? undefined
        : normalizeOrderedIds(data.originalPublisherIds);
    const demographies = data.directRelease ? [] : data.demographies;
    const orderedMagazines = data.directRelease
        ? []
        : data.magazineIds
            ? normalizeOrderedIds(data.magazineIds)
            : undefined;
    return {
        orderedOriginalPublishers,
        originalPublisherIds: orderedOriginalPublishers ? getOrderedIds(orderedOriginalPublishers) : undefined,
        demographies,
        orderedMagazines,
        magazineIds: orderedMagazines ? getOrderedIds(orderedMagazines) : undefined
    };
}

function getUpdateWorkValidationError(
    data: UpdateWorkData,
    relations: ReturnType<typeof prepareUpdateWorkRelations>
) {
    const duplicatedAuthors = data.authors
        ? findDuplicatedNumbers(data.authors.map(({ authorId }) => authorId))
        : [];
    if (duplicatedAuthors.length > 0) return AUTHOR_DUPLICATED_MESSAGE;
    if (hasDuplicatedWorkRelations(data, relations.demographies, relations.magazineIds, relations.originalPublisherIds)) {
        return 'Valores duplicados nos vinculos da Obra.';
    }
    if (hasInvalidPublicationPeriod(data)) {
        return 'O fim da publicação original não pode ser anterior ao início.';
    }
    return undefined;
}

async function findWorkForUpdate(workId: number) {
    return prisma.work.findUnique({
        where: { id: workId },
        select: {
            id: true,
            coverAssetId: true,
            country: true,
            typeId: true,
            authors: { select: { authorId: true } },
            originalPublishers: { select: { publisherId: true } },
            serializationMagazines: { select: { magazineId: true } }
        }
    });
}

async function getUpdateWorkDependencyError(
    workId: number,
    data: UpdateWorkData,
    relations: ReturnType<typeof prepareUpdateWorkRelations>,
    existingWork: NonNullable<Awaited<ReturnType<typeof findWorkForUpdate>>>
) {
    if (data.coverAssetId && !await isCoverAssetAttachable(data.coverAssetId, existingWork.coverAssetId)) {
        return { status: 400, error: 'A capa interna informada é inválida ou já está em uso.' };
    }
    if (data.title) {
        const duplicatedWork = await prisma.work.findFirst({
            where: { id: { not: workId }, title: { equals: data.title, mode: 'insensitive' } },
            select: { id: true }
        });
        if (duplicatedWork) return { status: 409, error: WORK_DUPLICATED_MESSAGE };
    }
    const referencesAreValid = await validatePartialWorkDomainReferences({
        ...data,
        originalPublisherIds: relations.originalPublisherIds,
        magazineIds: relations.magazineIds
    }, existingWork);
    if (!referencesAreValid) return { status: 400, error: INVALID_DOMAIN_REFERENCE_MESSAGE };
    return undefined;
}

function assignPublicationUpdateData(updateData: Record<string, unknown>, data: UpdateWorkData) {
    if (data.originalTitle !== undefined) updateData.originalTitle = data.originalTitle || null;
    if (data.romanizedTitle !== undefined) updateData.romanizedTitle = data.romanizedTitle;
    if (data.synopsis !== undefined) updateData.synopsis = data.synopsis;
    if (data.originalPublicationStartYear !== undefined) updateData.originalPublicationStartYear = data.originalPublicationStartYear || null;
    if (data.originalPublicationEndYear !== undefined) updateData.originalPublicationEndYear = data.originalPublicationEndYear || null;
}

function buildWorkUpdateData(data: UpdateWorkData) {
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    assignPublicationUpdateData(updateData, data);
    if (data.directRelease !== undefined) updateData.directRelease = data.directRelease;
    if (data.typeId !== undefined) updateData.typeId = data.typeId;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.originalPublicationStatus !== undefined) updateData.originalPublicationStatus = data.originalPublicationStatus;
    if (data.coverAssetId !== undefined) updateData.coverAssetId = data.coverAssetId;
    if (data.adultContent !== undefined) updateData.adultContent = data.adultContent;
    return updateData;
}

function getAuthorUpdateOperations(workId: number, authors: UpdateWorkData['authors']) {
    if (!authors) return [];
    const orderedAuthors = normalizeOrderedAuthors(authors);
    return [
        prisma.workAuthorRole.deleteMany({ where: { workId } }),
        prisma.workAuthor.deleteMany({ where: { workId } }),
        prisma.workAuthor.createMany({
            data: orderedAuthors.map(({ authorId, position }) => ({ workId, authorId, position }))
        }),
        prisma.workAuthorRole.createMany({
            data: orderedAuthors.flatMap((author) => author.roles.map((role) => ({
                workId,
                authorId: author.authorId,
                role
            })))
        })
    ];
}

function getGenreUpdateOperations(workId: number, genreIds: UpdateWorkData['genreIds']) {
    if (!genreIds) return [];
    return [
        prisma.workGenre.deleteMany({ where: { workId } }),
        prisma.workGenre.createMany({ data: genreIds.map((genreId) => ({ workId, genreId })) })
    ];
}

function getDemographyUpdateOperations(workId: number, demographies: UpdateWorkData['demographies']) {
    if (!demographies) return [];
    return [
        prisma.workDemography.deleteMany({ where: { workId } }),
        prisma.workDemography.createMany({ data: demographies.map((demography) => ({ workId, demography })) })
    ];
}

function getMagazineUpdateOperations(
    workId: number,
    magazines: ReturnType<typeof prepareUpdateWorkRelations>['orderedMagazines']
) {
    if (magazines === undefined) return [];
    return [
        prisma.workSerializationMagazine.deleteMany({ where: { workId } }),
        prisma.workSerializationMagazine.createMany({
            data: magazines.map(({ id, position }) => ({ workId, magazineId: id, position }))
        })
    ];
}

function getPublisherUpdateOperations(
    workId: number,
    publishers: ReturnType<typeof prepareUpdateWorkRelations>['orderedOriginalPublishers']
) {
    if (publishers === undefined) return [];
    return [
        prisma.workOriginalPublisher.deleteMany({ where: { workId } }),
        prisma.workOriginalPublisher.createMany({
            data: publishers.map(({ id, position }) => ({ workId, publisherId: id, position }))
        })
    ];
}

function buildWorkUpdateOperations(
    workId: number,
    data: UpdateWorkData,
    relations: ReturnType<typeof prepareUpdateWorkRelations>,
    currentCoverAssetId: string | null
) {
    return [
        prisma.work.update({ where: { id: workId }, data: buildWorkUpdateData(data) }),
        ...getAuthorUpdateOperations(workId, data.authors),
        ...getGenreUpdateOperations(workId, data.genreIds),
        ...getDemographyUpdateOperations(workId, relations.demographies),
        ...getMagazineUpdateOperations(workId, relations.orderedMagazines),
        ...getPublisherUpdateOperations(workId, relations.orderedOriginalPublishers),
        ...(data.coverAssetId && data.coverAssetId !== currentCoverAssetId
            ? [activateCoverAsset(prisma, data.coverAssetId)]
            : [])
    ];
}

async function updateWork(req: Request, res: Response, next: NextFunction) {
    const workId = parsePositiveId(req.params.id);
    if (!workId) return res.status(400).json({ error: 'Formato de identificador invalido.' });
    const validation = updateWorkSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: REQUIRED_WORK_FIELDS_MESSAGE });
    const data = validation.data;
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Informe ao menos um campo para alterar.' });
    const relations = prepareUpdateWorkRelations(data);
    const validationError = getUpdateWorkValidationError(data, relations);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
        const existingWork = await findWorkForUpdate(workId);
        if (!existingWork) return res.status(404).json({ error: 'Obra não encontrada.' });
        const dependencyError = await getUpdateWorkDependencyError(workId, data, relations, existingWork);
        if (dependencyError) return res.status(dependencyError.status).json({ error: dependencyError.error });
        await prisma.$transaction(buildWorkUpdateOperations(workId, data, relations, existingWork.coverAssetId));
        if (data.coverAssetId !== undefined && existingWork.coverAssetId !== data.coverAssetId) {
            await deleteOrphanedCoverAsset(existingWork.coverAssetId);
        }
        const work = await prisma.work.findUnique({
            where: { id: workId },
            include: getWorkDetailInclude()
        });
        return res.status(200).json({
            work: normalizeWorkDetail(work as unknown as WorkDetailInput)
        });
    } catch (error) {
        const knownError = error as PrismaKnownError;
        if (knownError.code === 'P2002') return res.status(409).json({ error: WORK_DUPLICATED_MESSAGE });
        return next(error);
    }
}

async function deleteWork(req: Request, res: Response, next: NextFunction) {
    const workId = parsePositiveId(req.params.id);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true, visibility: true, coverAssetId: true }
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        if (isPublicVisibility(work.visibility)) {
            return res.status(409).json({ error: 'Essa Obra está pública, não pode ser excluída!' });
        }

        const linkedEditionsCount = await prisma.edition.count({
            where: { workId }
        });

        if (linkedEditionsCount > 0) {
            return res.status(409).json({ error: WORK_WITH_EDITIONS_DELETE_MESSAGE });
        }

        await prisma.$transaction([
            prisma.work.delete({ where: { id: workId } })
        ]);

        await deleteOrphanedCoverAsset(work.coverAssetId);

        return res.status(200).json({ message: 'Obra excluída com sucesso.' });

    } catch (error) {
        return next(error);
    }
}

async function updateWorkVisibility(req: Request, res: Response, next: NextFunction) {
    const workId = parsePositiveId(req.params.id);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateWorkVisibilitySchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Visibilidade invalida.' });
    }

    const visibility = normalizeVisibility(validation.data.visibility);

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true, visibility: true }
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        if (visibility === 'Privado' && isPublicVisibility(work.visibility)) {
            const publicEditionsCount = await ((prisma as unknown as {
                edition?: { count: (args: unknown) => Promise<number> }
            }).edition?.count({
                where: {
                    workId,
                    visibility: 'Público'
                }
            }) ?? Promise.resolve(0));

            if (publicEditionsCount > 0) {
                return res.status(409).json({
                    error: 'Essa Obra possui Edições públicas, não pode ser rebaixada para privada!'
                });
            }
        }

        const updatedWork = await prisma.work.update({
            where: { id: workId },
            data: { visibility },
            include: getWorkDetailInclude()
        });

        return res.status(200).json({
            work: normalizeWorkDetail(updatedWork as unknown as WorkDetailInput)
        });

    } catch (error) {
        return next(error);
    }
}
export {
    createWork,
    listWorks,
    getWorkBySlug,
    getWorkById,
    updateWork,
    deleteWork,
    updateWorkVisibility
};
