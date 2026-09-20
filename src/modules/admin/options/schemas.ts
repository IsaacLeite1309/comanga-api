import { z } from 'zod';

const categoryParamSchema = z.object({
    category: z.string().trim().min(1)
});

const listOptionsQuerySchema = z.object({
    term: z.string().trim().optional(),
    includeInactive: z.enum(['true', 'false']).default('false')
        .transform((value) => value === 'true'),
    dependsOn: z.coerce.number().int().positive().optional(),
    order: z.enum(['ASC', 'DESC']).default('ASC'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(6)
});

const createOptionSchema = z.object({
    category: z.string().trim().min(1),
    label: z.string().trim().min(1),
    dependsOnValueIds: z.array(z.coerce.number().int().positive()).optional().default([])
});

const updateOptionSchema = z.object({
    label: z.string().trim().min(1).optional(),
    dependsOnValueIds: z.array(z.coerce.number().int().positive()).optional(),
    active: z.boolean().optional()
});

const reorderOptionsSchema = z.object({
    valueIds: z.array(z.coerce.number().int().positive()).min(1)
});

export {
    categoryParamSchema,
    createOptionSchema,
    listOptionsQuerySchema,
    reorderOptionsSchema,
    updateOptionSchema
};
