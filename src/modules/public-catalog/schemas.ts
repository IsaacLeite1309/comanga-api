import { z } from 'zod';
import { PUBLIC_WORK_COUNTRIES, PUBLIC_WORK_DEMOGRAPHICS } from './constants';

function parseListInput(value: unknown): unknown {
    if (value === undefined) return undefined;

    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item) => (
        typeof item === 'string'
            ? item.split(',').map((part) => part.trim()).filter(Boolean)
            : [item]
    ));
}

const positiveIntegerListSchema = z.preprocess(
    parseListInput,
    z.array(z.coerce.number().int().positive()).min(1).max(50)
        .transform((values) => [...new Set(values)])
        .optional()
);

const demographyListSchema = z.preprocess(
    parseListInput,
    z.array(z.enum(PUBLIC_WORK_DEMOGRAPHICS)).min(1).max(PUBLIC_WORK_DEMOGRAPHICS.length)
        .transform((values) => [...new Set(values)])
        .optional()
);

const paginationShape = {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12)
};

const publicWorksQuerySchema = z.object({
    term: z.string().trim().max(255).optional(),
    typeId: z.coerce.number().int().positive().optional(),
    country: z.enum(PUBLIC_WORK_COUNTRIES).optional(),
    demographics: demographyListSchema,
    genreIds: positiveIntegerListSchema,
    sortBy: z.enum(['title', 'originalTitle', 'createdAt']).default('title'),
    order: z.enum(['ASC', 'DESC']).default('ASC'),
    ...paginationShape
});

const publicEditionsQuerySchema = z.object({
    term: z.string().trim().max(255).optional(),
    brazilianPublisherId: z.coerce.number().int().positive().optional(),
    formatId: z.coerce.number().int().positive().optional(),
    coverTypeId: z.coerce.number().int().positive().optional(),
    sortBy: z.enum(['title', 'chronologicalNumber', 'createdAt']).default('title'),
    order: z.enum(['ASC', 'DESC']).default('ASC'),
    ...paginationShape
});

const publicEntityIdParamsSchema = z.object({
    editionId: z.coerce.number().int().positive()
});

const publicDetailsQuerySchema = z.object({
    ...paginationShape
});

export {
    parseListInput,
    publicWorksQuerySchema,
    publicEditionsQuerySchema,
    publicEntityIdParamsSchema,
    publicDetailsQuerySchema
};
