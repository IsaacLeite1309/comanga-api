import type { NextFunction, Request, Response } from 'express';
import { withCatalogWriteLock } from '../writeLock';
import { WorkDetailInput, normalizeVisibility, normalizeWorkDetail, updateWorkVisibilitySchema, getWorkDetailInclude, parsePositiveId } from '../shared';

export { updateWorkVisibility };

async function persistWorkVisibility(workId: number, visibility: string) {
    return withCatalogWriteLock(async tx => {
        const work = await tx.work.findUnique({ where: { id: workId }, select: { id: true } });
        if (!work) return { status: 404, error: 'Obra não encontrada.' } as const;
        if (visibility === 'Privado' && await tx.edition.count({ where: { workId, visibility: 'Público' } }) > 0) {
            return { status: 409, error: 'Essa Obra possui Edições públicas, não pode ser rebaixada para privada!' } as const;
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
