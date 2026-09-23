import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../prisma';
import { withCatalogWriteLock } from '../writeLock';
import { prepareVolumeReleaseUpdate } from './releaseDate';
import {
    activateCoverAsset,
    deleteOrphanedCoverAsset,
    isCoverAssetAttachable
} from '../../media';
import {
    EDITION_COVER_SOURCE_VOLUME_NUMBER,
    PUBLIC_EDITION_COVER_SOURCE_MESSAGE,
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
        number: data.singleVolume ? 1 : data.number,
        coverAssetId: data.coverAssetId,
        singleVolume: withCreateDefault(data.singleVolume, false, mode),
        pages: withCreateDefault(data.pages, null, mode),
        price: withCreateDefault(data.price, null, mode),
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
        const result = await withCatalogWriteLock(async tx => {
            const existingVolume = await tx.volume.findFirst({
                where: { editionId, ...(validation.data.singleVolume ? {} : { singleVolume: true }) },
                select: { id: true }
            });
            if (existingVolume) {
                return { error: 'Esta Edição não pode ter outros Volumes enquanto houver um Volume único.' } as const;
            }
            const volume = await createVolumeRecord(tx as typeof prisma);
            if (validation.data.coverAssetId) {
                await activateCoverAsset(tx, validation.data.coverAssetId);
            }
            return { volume } as const;
        });
        if ('error' in result) return res.status(409).json({ error: result.error });
        const { volume } = result;

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

async function getVolumeByNumber(req: Request, res: Response, next: NextFunction) {
    const editionNumber = parsePositiveId(req.params.editionNumber);
    const volumeNumber = parsePositiveId(req.params.volumeNumber);
    const workSlug = req.params.workSlug;
    if (!editionNumber || !volumeNumber || typeof workSlug !== 'string' || !workSlug) {
        return res.status(400).json({ error: 'Endereço do Volume inválido.' });
    }
    try {
        const volume = await prisma.volume.findFirst({
            where: {
                number: volumeNumber,
                edition: { chronologicalNumber: editionNumber, work: { slug: workSlug } }
            },
            include: { coverAsset: { select: { id: true, objectKey: true, variants: { select: { kind: true, objectKey: true } } } } }
        });
        if (!volume) return res.status(404).json({ error: 'Volume não encontrado.' });
        return res.status(200).json({ volume: normalizeVolume(volume as unknown as VolumeInput) });
    } catch (error) {
        return next(error);
    }
}

// Em Edição pública a capa vem do Volume 1: renumerá-lo deixaria a Edição sem origem de capa.
function removesPublicEditionCoverSource(
    volume: { number: number; edition: { visibility: string } },
    nextNumber?: number
) {
    return volume.number === EDITION_COVER_SOURCE_VOLUME_NUMBER
        && nextNumber !== undefined
        && nextNumber !== EDITION_COVER_SOURCE_VOLUME_NUMBER
        && isPublicVisibility(volume.edition.visibility);
}

async function persistVolumeUpdate(volumeId: number, data: VolumePayload) {
    return withCatalogWriteLock(async tx => {
        const existingVolume = await tx.volume.findUnique({
            where: { id: volumeId },
            select: {
                id: true,
                editionId: true,
                number: true,
                singleVolume: true,
                coverAssetId: true,
                releaseDatePrecision: true,
                releaseYear: true,
                releaseMonth: true,
                releaseDay: true,
                edition: { select: { visibility: true } }
            }
        });

        if (!existingVolume) {
            return { status: 404, error: 'Volume não encontrado.' } as const;
        }

        const nextSingleVolume = data.singleVolume ?? existingVolume.singleVolume;
        const nextNumber = nextSingleVolume ? 1 : data.number;
        if (removesPublicEditionCoverSource(existingVolume, nextNumber)) {
            return { status: 409, error: PUBLIC_EDITION_COVER_SOURCE_MESSAGE } as const;
        }

        const conflictingVolume = await tx.volume.findFirst({
            where: {
                editionId: existingVolume.editionId,
                id: { not: volumeId },
                ...(nextSingleVolume ? {} : { singleVolume: true })
            },
            select: { id: true }
        });
        if (conflictingVolume) {
            return { status: 409, error: 'Esta Edição não pode ter outros Volumes enquanto houver um Volume único.' } as const;
        }

        if (
            data.coverAssetId
            && !await isCoverAssetAttachable(data.coverAssetId, existingVolume.coverAssetId, tx)
        ) {
            return { status: 400, error: 'A capa interna informada é inválida ou já está em uso.' } as const;
        }

        const release = prepareVolumeReleaseUpdate(existingVolume, data);
        if (!release.success) return { status: 400, error: 'Informe uma data de lançamento válida para o Volume.' } as const;

        const volume = await tx.volume.update({
                where: { id: volumeId },
                data: buildVolumeData({ ...data, ...release.data, number: nextNumber }, 'update'),
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
            data.coverAssetId
            && data.coverAssetId !== existingVolume.coverAssetId
        );
        if (shouldActivateCover) await activateCoverAsset(tx, data.coverAssetId as string);
        return { volume, previousCoverAssetId: existingVolume.coverAssetId } as const;
    });
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
        const result = await persistVolumeUpdate(volumeId, validation.data);
        if (result.status !== undefined) return res.status(result.status).json({ error: result.error });
        const { volume, previousCoverAssetId } = result;

        if (validation.data.coverAssetId !== undefined && previousCoverAssetId !== validation.data.coverAssetId) {
            await deleteOrphanedCoverAsset(previousCoverAssetId);
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
        const result = await withCatalogWriteLock(async tx => {
            const volume = await tx.volume.findUnique({
                where: { id: volumeId },
                select: { id: true, visibility: true, coverAssetId: true }
            });

            if (!volume) {
                return { status: 404, error: 'Volume não encontrado.' } as const;
            }

            if (isPublicVisibility(volume.visibility)) {
                return { status: 409, error: PUBLIC_VOLUME_DELETE_MESSAGE } as const;
            }

            await tx.volume.delete({
                where: { id: volumeId }
            });

            return { volume } as const;
        });
        if (result.status !== undefined) return res.status(result.status).json({ error: result.error });
        const { volume } = result;

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
    getVolumeByNumber,
    updateVolume,
    deleteVolume
};
