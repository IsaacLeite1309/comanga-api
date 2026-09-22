import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../../prisma';
import { withCatalogWriteLock } from '../writeLock';
import {
    INVALID_DOMAIN_REFERENCE_MESSAGE,
    EDITION_COVER_SOURCE_VOLUME_NUMBER,
    EDITION_DUPLICATED_MESSAGE,
    EDITION_WITHOUT_COVER_SOURCE_MESSAGE,
    PRIVATE_WORK_PUBLIC_EDITION_MESSAGE,
    PUBLIC_EDITION_DELETE_MESSAGE,
    EDITION_WITH_VOLUMES_DELETE_MESSAGE,
    PrismaKnownError,
    EditionInput,
    isPublicVisibility,
    normalizeVisibility,
    normalizeEdition,
    validateEditionDomainReferences,
    editionPayloadSchema,
    updateEditionSchema,
    listEditionsQuerySchema,
    updateEditionVisibilitySchema,
    getEditionInclude,
    parsePositiveId
} from '../shared';

// Sinaliza publicação recusada por falta do Volume 1 com capa, desfazendo a transação.
class MissingEditionCoverSourceError extends Error {}

async function createEdition(req: Request, res: Response, next: NextFunction) {
    const workId = parsePositiveId(req.params.workId);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = editionPayloadSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Preencha os campos obrigatórios da Edição.' });
    }

    const data = validation.data;

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true }
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        const referencesAreValid = await validateEditionDomainReferences(data);

        if (!referencesAreValid) {
            return res.status(400).json({ error: INVALID_DOMAIN_REFERENCE_MESSAGE });
        }

        const createData = {
            workId,
            brazilianPublisherId: data.brazilianPublisherId,
            coverTypeId: data.coverTypeId,
            formatId: data.formatId,
            paperId: data.paperId,
            chronologicalNumber: data.chronologicalNumber,
            brazilPublicationStatus: data.brazilPublicationStatus,
            visibility: 'Privado'
        };
        const edition = await prisma.edition.create({ data: createData, include: getEditionInclude() });

        return res.status(201).json({
            edition: normalizeEdition(edition as unknown as EditionInput)
        });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: EDITION_DUPLICATED_MESSAGE });
        }

        return next(error);
    }
}

async function listEditionsByWork(req: Request, res: Response, next: NextFunction) {
    const workId = parsePositiveId(req.params.workId);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = listEditionsQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: 'Filtros de consulta inválidos.' });
    }

    const { page, limit, order } = validation.data;

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true }
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        const [editions, total] = await prisma.$transaction([
            prisma.edition.findMany({
                where: { workId },
                include: getEditionInclude(),
                orderBy: { chronologicalNumber: order.toLowerCase() as 'asc' | 'desc' },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.edition.count({ where: { workId } })
        ]);

        return res.status(200).json({
            editions: editions.map((edition) => normalizeEdition(edition as unknown as EditionInput)),
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

async function getEditionById(req: Request, res: Response, next: NextFunction) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            include: getEditionInclude()
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        return res.status(200).json({
            edition: normalizeEdition(edition as unknown as EditionInput)
        });

    } catch (error) {
        return next(error);
    }
}

async function updateEdition(req: Request, res: Response, next: NextFunction) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateEditionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Informe ao menos um campo válido para alterar.' });
    }

    const data = validation.data;

    try {
        const existingEdition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true }
        });

        if (!existingEdition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const referencesAreValid = await validateEditionDomainReferences(data);

        if (!referencesAreValid) {
            return res.status(400).json({ error: INVALID_DOMAIN_REFERENCE_MESSAGE });
        }

        const edition = await prisma.edition.update({
            where: { id: editionId },
            data: {
                ...(data.brazilianPublisherId !== undefined ? { brazilianPublisherId: data.brazilianPublisherId } : {}),
                ...(data.coverTypeId !== undefined ? { coverTypeId: data.coverTypeId } : {}),
                ...(data.formatId !== undefined ? { formatId: data.formatId } : {}),
                ...(data.paperId !== undefined ? { paperId: data.paperId } : {}),
                ...(data.chronologicalNumber !== undefined ? { chronologicalNumber: data.chronologicalNumber } : {}),
                ...(data.brazilPublicationStatus !== undefined ? { brazilPublicationStatus: data.brazilPublicationStatus } : {})
            },
            include: getEditionInclude()
        });

        return res.status(200).json({
            edition: normalizeEdition(edition as unknown as EditionInput)
        });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: EDITION_DUPLICATED_MESSAGE });
        }

        return next(error);
    }
}

async function deleteEdition(req: Request, res: Response, next: NextFunction) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true, visibility: true }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        if (isPublicVisibility(edition.visibility)) {
            return res.status(409).json({ error: PUBLIC_EDITION_DELETE_MESSAGE });
        }

        const linkedVolumesCount = await prisma.volume.count({
            where: { editionId }
        });

        if (linkedVolumesCount > 0) {
            return res.status(409).json({ error: EDITION_WITH_VOLUMES_DELETE_MESSAGE });
        }

        await prisma.$transaction([
            prisma.edition.delete({
                where: { id: editionId }
            })
        ]);

        return res.status(200).json({ message: 'Edição excluída com sucesso.' });

    } catch (error) {
        return next(error);
    }
}

async function assertEditionCanBecomePrivate(editionId: number) {
    // Ponto de extensão para bloquear rebaixamento quando houver volumes em estantes de usuários.
    await Promise.resolve(editionId);
}

// Valida o estado final da publicação: o Volume 1 precisa existir, estar público e ter capa.
async function assertPublishedEditionHasCoverSource(tx: Prisma.TransactionClient, editionId: number) {
    const coverSourceVolume = await tx.volume.findFirst({
        where: { editionId, number: EDITION_COVER_SOURCE_VOLUME_NUMBER },
        select: { coverAssetId: true, visibility: true }
    });

    if (!coverSourceVolume?.coverAssetId || !isPublicVisibility(coverSourceVolume.visibility)) {
        throw new MissingEditionCoverSourceError();
    }
}

async function applyEditionVisibility(editionId: number, visibility: string) {
    return withCatalogWriteLock(async (tx) => {
        const updatedEdition = await tx.edition.update({
            where: { id: editionId },
            data: { visibility },
            include: getEditionInclude()
        });
        await tx.volume.updateMany({
            where: { editionId },
            data: { visibility }
        });

        if (isPublicVisibility(visibility)) {
            await assertPublishedEditionHasCoverSource(tx, editionId);
        }

        return updatedEdition;
    });
}

async function updateEditionVisibility(req: Request, res: Response, next: NextFunction) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateEditionVisibilitySchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Visibilidade invalida.' });
    }

    const visibility = normalizeVisibility(validation.data.visibility);

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: {
                id: true,
                work: {
                    select: {
                        visibility: true
                    }
                }
            }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        if (isPublicVisibility(visibility) && !isPublicVisibility(edition.work.visibility)) {
            return res.status(409).json({ error: PRIVATE_WORK_PUBLIC_EDITION_MESSAGE });
        }

        if (visibility === 'Privado') {
            await assertEditionCanBecomePrivate(editionId);
        }

        const updatedEdition = await applyEditionVisibility(editionId, visibility);

        return res.status(200).json({
            edition: normalizeEdition(updatedEdition as unknown as EditionInput)
        });

    } catch (error) {
        if (error instanceof MissingEditionCoverSourceError) {
            return res.status(409).json({ error: EDITION_WITHOUT_COVER_SOURCE_MESSAGE });
        }

        return next(error);
    }
}
export {
    createEdition,
    listEditionsByWork,
    getEditionById,
    updateEdition,
    deleteEdition,
    updateEditionVisibility
};
