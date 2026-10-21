import type { NextFunction, Request, Response } from 'express';
import prisma from '../../prisma';
import { PUBLIC_AUTHOR_CATEGORY } from './constants';
import { canViewAdultContent } from './adultContentPolicy';
import { mapOption, mapPublicWork } from './mappers';
import { buildPublicAuthorWorksWhere, buildPublicWorkOrderBy, publicWorkSelect } from './queries';
import { publicAuthorIdParamsSchema, publicAuthorWorksQuerySchema } from './schemas';

import { INVALID_PUBLIC_PARAMETERS_MESSAGE, pagination, prepareViewerDependentResponse } from './response';

export { listPublicAuthorWorks };

async function listPublicAuthorWorks(req: Request, res: Response, next: NextFunction) {
    const paramsValidation = publicAuthorIdParamsSchema.safeParse(req.params);
    const queryValidation = publicAuthorWorksQuerySchema.safeParse(req.query);

    if (!paramsValidation.success || !queryValidation.success) {
        return res.status(400).json({ error: INVALID_PUBLIC_PARAMETERS_MESSAGE });
    }

    const { authorId } = paramsValidation.data;
    const query = queryValidation.data;

    try {
        const author = await prisma.domainOptionValue.findFirst({
            where: { code: authorId, category: { slug: PUBLIC_AUTHOR_CATEGORY } },
            select: { id: true, label: true, code: true }
        });
        if (!author) return res.status(404).json({ error: 'Autor não encontrado.' });
        const where = buildPublicAuthorWorksWhere(author.id, canViewAdultContent(req));
        const [works, total] = await prisma.$transaction([
            prisma.work.findMany({
                where,
                select: publicWorkSelect,
                orderBy: buildPublicWorkOrderBy(query.sortBy, query.order),
                skip: (query.page - 1) * query.limit,
                take: query.limit
            }),
            prisma.work.count({ where })
        ]);

        prepareViewerDependentResponse(res);
        return res.status(200).json({
            author: { ...mapOption(author), slug: author.code },
            works: works.map((work) => ({
                ...mapPublicWork(work),
                authorRoles: work.authors.find(({ author: creditedAuthor }) => creditedAuthor.id === author.id)
                    ?.roles.map(({ role }) => role) ?? []
            })),
            pagination: pagination(query.page, query.limit, total)
        });
    } catch (error) {
        return next(error);
    }
}
