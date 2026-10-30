import type { NextFunction, Request, Response } from 'express';
import { withCatalogWriteLock } from '../writeLock';
import { WorkDetailInput, normalizeVisibility, normalizeWorkDetail, updateWorkVisibilitySchema, getWorkDetailInclude, parsePositiveId } from '../shared';

export { updateWorkVisibility };

async function persistWorkVisibility(workId: number, visibility: string) {
    return withCatalogWriteLock(async tx => {
        const work = await tx.work.findUnique({ where: { id: workId }, select: { id: true, visibility: true } });
        if (!work) return { status: 404, error: 'Obra não encontrada.' } as const;
        const isPublishing = work.visibility !== 'Público' && visibility === 'Público';
        if (isPublishing) {
            const incompleteEdition = await tx.edition.findFirst({
                where: { workId, volumes: { none: { number: 1 } } },
                orderBy: { chronologicalNumber: 'asc' },
                select: { chronologicalNumber: true }
            });
            if (incompleteEdition) {
                return {
                    status: 409,
                    error: `A Edição ${incompleteEdition.chronologicalNumber} precisa ter o Volume 1 com capa antes de publicar a Obra.`
                } as const;
            }
        }
        if (work.visibility !== visibility) {
            await tx.volume.updateMany({
                where: { edition: { workId } },
                data: { visibility }
            });
            await tx.edition.updateMany({
                where: { workId },
                data: { visibility }
            });
        }
        const updatedWork = await tx.work.update({
            where: { id: workId }, data: { visibility }, include: getWorkDetailInclude()
        });
        return { work: updatedWork } as const;
    });
}

async function updateWorkVisibility(req: Request, res: Response, next: NextFunction) {
    const workId = parsePositiveId(req.params.id);
    if (!workId) return res.status(400).json({ error: 'Formato de identificador invalido.' });
    const validation = updateWorkVisibilitySchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: 'Visibilidade invalida.' });

    try {
        const result = await persistWorkVisibility(workId, normalizeVisibility(validation.data.visibility));
        if (result.status !== undefined) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ work: normalizeWorkDetail(result.work as unknown as WorkDetailInput) });
    } catch (error) {
        return next(error);
    }
}
