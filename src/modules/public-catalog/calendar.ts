import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import { canViewAdultContent } from './adultContentPolicy';
import { mapPublicCalendarVolume } from './mappers';
import { buildPublicCalendarWhere, publicCalendarOrderBy, publicCalendarVolumeSelect } from './queries';
import { publicCalendarQuerySchema } from './schemas';

import { INVALID_PUBLIC_FILTERS_MESSAGE, pagination, prepareViewerDependentResponse } from './response';

export { listPublicCalendar };

async function listPublicCalendar(req: Request, res: Response, next: NextFunction) {
    const validation = publicCalendarQuerySchema.safeParse(req.query);
    if (!validation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_FILTERS_MESSAGE });
    }

    const now = new Date();
    const query = {
        ...validation.data,
        year: validation.data.year ?? now.getFullYear(),
        month: validation.data.month ?? now.getMonth() + 1
    };
    const where = buildPublicCalendarWhere(query, canViewAdultContent(req));

    try {
        const [volumes, total] = await prisma.$transaction([
            prisma.volume.findMany({
                where,
                select: publicCalendarVolumeSelect,
                orderBy: publicCalendarOrderBy(query.order),
                skip: (query.page - 1) * query.limit,
                take: query.limit
            }),
            prisma.volume.count({ where })
        ]);

        prepareViewerDependentResponse(res);
        return res.status(200).json({
            year: query.year,
            month: query.month,
            volumes: volumes.map(mapPublicCalendarVolume),
            pagination: pagination(query.page, query.limit, total)
        });
    } catch (error) {
        return next(error);
    }
}
