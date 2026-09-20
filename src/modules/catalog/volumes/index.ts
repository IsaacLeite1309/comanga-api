import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../prisma';
import {
    activateCoverAsset,
    deleteOrphanedCoverAsset,
    isCoverAssetAttachable
} from '../../media';
import {
    VOLUME_DUPLICATED_MESSAGE,
    PUBLIC_VOLUME_DELETE_MESSAGE,
    PrismaKnownError,
    VolumeInput,
    isPublicVisibility,
    normalizeVolume,
    volumePayloadBaseSchema,
    volumePayloadSchema,
    updateVolumeSchema,
    listVolumesQuerySchema,
    parsePositiveId
} from '../shared';

type VolumePayload = Partial<z.infer<typeof volumePayloadBaseSchema>>;

function withCreateDefault<T>(value: T | undefined, fallback: T, mode: 'create' | 'update') {
    return value === undefined && mode === 'create' ? fallback : value;
}

function normalizeOptionalNullable<T>(value: T | null | undefined) {
    return value === undefined ? undefined : value || null;
}

function buildVolumeReleaseData(data: VolumePayload, mode: 'create' | 'update') {
    const releaseDatePrecision = data.releaseDatePrecision ?? (mode === 'create' ? 'Completa' : undefined);

    if (releaseDatePrecision !== undefined) {
        return {
            releaseDatePrecision,
            releaseYear: data.releaseYear ?? null,
            releaseMonth: ['Completa', 'Mes e ano'].includes(releaseDatePrecision) ? data.releaseMonth ?? null : null,
            releaseDay: releaseDatePrecision === 'Completa' ? data.releaseDay ?? null : null
        };
    }

    return {
        ...('releaseYear' in data ? { releaseYear: data.releaseYear ?? null } : {}),
        ...('releaseMonth' in data ? { releaseMonth: data.releaseMonth ?? null } : {}),
        ...('releaseDay' in data ? { releaseDay: data.releaseDay ?? null } : {})
    };
}

function buildVolumeData(data: VolumePayload, mode: 'create' | 'update' = 'create') {
    return {
        number: data.number,
        coverAssetId: data.coverAssetId,
        singleVolume: withCreateDefault(data.singleVolume, false, mode),
        pages: data.pages ?? null,
        price: data.price ?? null,
        priceCurrency: withCreateDefault(data.priceCurrency, 'R$', mode),
        isbn10: normalizeOptionalNullable(data.isbn10),
        isbn13: normalizeOptionalNullable(data.isbn13),
        affiliateLink: normalizeOptionalNullable(data.affiliateLink),
        synopsis: normalizeOptionalNullable(data.synopsis),
        ...buildVolumeReleaseData(data, mode)
    } as Prisma.VolumeUncheckedUpdateInput;
}

async function createVolume(req: Request, res: Response, next: NextFunction) {
    const editionId = parsePositiveId(req.params.editionId);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = volumePayloadSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Preencha os campos obrigatórios do Volume.' });
    }

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true, visibility: true }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        if (validation.data.coverAssetId && !await isCoverAssetAttachable(validation.data.coverAssetId)) {
            return res.status(400).json({ error: 'A capa interna informada é inválida ou já está em uso.' });
        }

        const createVolumeRecord = (client: typeof prisma) => client.volume.create({
                data: {
                    editionId,
                    ...buildVolumeData(validation.data),
                    visibility: edition.visibility
                } as Prisma.VolumeUncheckedCreateInput,
                include: {
                    coverAsset: {
                        select: {
                            id: true,
                            objectKey: true,
                            variants: { select: { kind: true, objectKey: true } }
                        }
                    }
                }
            });
        const volume = validation.data.coverAssetId
            ? await prisma.$transaction(async (tx) => {
                const createdVolume = await createVolumeRecord(tx as typeof prisma);
                await activateCoverAsset(tx, validation.data.coverAssetId as string);
                return createdVolume;
            })
            : await createVolumeRecord(prisma);

        return res.status(201).json({ volume: normalizeVolume(volume as unknown as VolumeInput) });
    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: VOLUME_DUPLICATED_MESSAGE });
        }

        return next(error);
    }
}

async function listVolumesByEdition(req: Request, res: Response, next: NextFunction) {
    const editionId = parsePositiveId(req.params.editionId);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = listVolumesQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: 'Filtros de consulta inválidos.' });
    }

    const { page, limit, order } = validation.data;

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const [volumes, total] = await prisma.$transaction([
            prisma.volume.findMany({
                where: { editionId },
                orderBy: { number: order.toLowerCase() as 'asc' | 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    coverAsset: {
                        select: {
                            id: true,
                            objectKey: true,
                            variants: { select: { kind: true, objectKey: true } }
                        }
                    }
                }
            }),
            prisma.volume.count({ where: { editionId } })
        ]);

        return res.status(200).json({
            volumes: volumes.map((volume) => normalizeVolume(volume as unknown as VolumeInput)),
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

async function getVolumeById(req: Request, res: Response, next: NextFunction) {
    const volumeId = parsePositiveId(req.params.id);

    if (!volumeId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const volume = await prisma.volume.findUnique({
            where: { id: volumeId },
            include: {
                coverAsset: {
                    select: {
                        id: true,
                        objectKey: true,
                        variants: { select: { kind: true, objectKey: true } }
                    }
                }
            }
        });

        if (!volume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }

        return res.status(200).json({ volume: normalizeVolume(volume as unknown as VolumeInput) });
    } catch (error) {
        return next(error);
    }
}

async function updateVolume(req: Request, res: Response, next: NextFunction) {
    const volumeId = parsePositiveId(req.params.id);

    if (!volumeId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateVolumeSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Informe ao menos um campo valido para alterar.' });
    }

    try {
        const existingVolume = await prisma.volume.findUnique({
            where: { id: volumeId },
            select: { id: true, coverAssetId: true }
        });

        if (!existingVolume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }

        if (
            validation.data.coverAssetId
            && !await isCoverAssetAttachable(validation.data.coverAssetId, existingVolume.coverAssetId)
        ) {
            return res.status(400).json({ error: 'A capa interna informada é inválida ou já está em uso.' });
        }

        const updateVolumeRecord = (client: typeof prisma) => client.volume.update({
                where: { id: volumeId },
                data: buildVolumeData(validation.data, 'update'),
                include: {
                    coverAsset: {
                        select: {
                            id: true,
                            objectKey: true,
                            variants: { select: { kind: true, objectKey: true } }
                        }
                    }
                }
            });
        const shouldActivateCover = Boolean(
            validation.data.coverAssetId
            && validation.data.coverAssetId !== existingVolume.coverAssetId
        );
        const volume = shouldActivateCover
            ? await prisma.$transaction(async (tx) => {
                const updatedVolume = await updateVolumeRecord(tx as typeof prisma);
                await activateCoverAsset(tx, validation.data.coverAssetId as string);
                return updatedVolume;
            })
            : await updateVolumeRecord(prisma);

        if (validation.data.coverAssetId !== undefined && existingVolume.coverAssetId !== validation.data.coverAssetId) {
            await deleteOrphanedCoverAsset(existingVolume.coverAssetId);
        }

        return res.status(200).json({ volume: normalizeVolume(volume as unknown as VolumeInput) });
    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: VOLUME_DUPLICATED_MESSAGE });
        }

        return next(error);
    }
}

async function deleteVolume(req: Request, res: Response, next: NextFunction) {
    const volumeId = parsePositiveId(req.params.id);

    if (!volumeId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const volume = await prisma.volume.findUnique({
            where: { id: volumeId },
            select: { id: true, visibility: true, coverAssetId: true }
        });

        if (!volume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }

        if (isPublicVisibility(volume.visibility)) {
            return res.status(409).json({ error: PUBLIC_VOLUME_DELETE_MESSAGE });
        }

        await prisma.volume.delete({
            where: { id: volumeId }
        });

        await deleteOrphanedCoverAsset(volume.coverAssetId);

        return res.status(200).json({ message: 'Volume excluido com sucesso.' });
    } catch (error) {
        return next(error);
    }
}
export {
    createVolume,
    listVolumesByEdition,
    getVolumeById,
    updateVolume,
    deleteVolume
};
