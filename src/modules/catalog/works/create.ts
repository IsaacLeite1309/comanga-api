import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../../prisma';
import { createUniqueWorkSlug } from './workSlug';
import { activateCoverAsset, isCoverAssetAttachable } from '../../media';
import { AUTHOR_DUPLICATED_MESSAGE, WORK_DUPLICATED_MESSAGE, REQUIRED_WORK_FIELDS_MESSAGE, INVALID_DOMAIN_REFERENCE_MESSAGE, PrismaKnownError, WorkDetailInput, normalizeWorkDetail, normalizeOrderedIds, normalizeOrderedAuthors, getOrderedIds, findDuplicatedNumbers, containsHentaiGenre, containsGenreWithoutDemography, validateWorkDomainReferences, createWorkSchema, getWorkDetailInclude } from '../shared';

import { hasDuplicatedWorkRelations, hasInvalidPublicationPeriod } from './validation';

export { createWork };

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

// Obra com Hentai nunca fica como não adulta: a flag é normalizada no backend,
// independentemente do que o formulário enviar (seção 14 do guia).
async function normalizeAdultContentOnCreate(data: CreateWorkData) {
    if (data.adultContent) return true;
    return containsHentaiGenre(data.genreIds);
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
        if (await containsGenreWithoutDemography(data.genreIds)) relations.demographies = [];
        const slug = await createUniqueWorkSlug(data.title, prisma.work);
        const adultContent = await normalizeAdultContentOnCreate(data);
        const workId = await persistCreatedWork({ ...data, adultContent }, relations, slug);
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
