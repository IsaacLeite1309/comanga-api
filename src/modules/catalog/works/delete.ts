import type { NextFunction, Request, Response } from 'express';
import prisma from '../../../prisma';
import { deleteOrphanedCoverAsset } from '../../media';
import { WORK_WITH_EDITIONS_DELETE_MESSAGE, isPublicVisibility, parsePositiveId } from '../shared';

export { deleteWork };

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
