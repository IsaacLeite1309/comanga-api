import type { NextFunction, Request, Response } from 'express';
import prisma from '../../../prisma';
import { WorkDetailInput, normalizeWorkSummary, normalizeWorkDetail, listWorksQuerySchema, getWorkSummaryInclude, getWorkOrderBy, sortWorkSummariesInMemory, getWorkDetailInclude } from '../shared';

export { listWorks, getWorkById, getWorkBySlug };

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
