import { z } from 'zod';

const identifier = z.number().int().positive().max(2147483647);
const parameterId = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647));
const volumeParamsSchema = z.object({ volumeId: parameterId });
const editionParamsSchema = z.object({ editionId: parameterId });
const readSchema = z.object({ read: z.boolean() }).strict();
const batchSchema = z.object({
    addVolumeIds: z.array(identifier).max(100),
    removeVolumeIds: z.array(identifier).max(100)
}).strict().refine(({ addVolumeIds, removeVolumeIds }) => {
    const ids = [...addVolumeIds, ...removeVolumeIds];
    return ids.length <= 100 && new Set(ids).size === ids.length;
});
const pageInteger = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647));
const paginationFields = {
    page: pageInteger.default(1),
    limit: pageInteger.pipe(z.number().max(50)).default(12)
};
const validPage = ({ page, limit }: { page: number; limit: number }) => (page - 1) * limit <= 2147483647;
const paginationSchema = z.object(paginationFields).strict().refine(validPage);
const selectionQuerySchema = z.object({ ...paginationFields, all: z.literal('true').optional() }).strict().refine(validPage);
const collectionQuerySchema = z.object({
    ...paginationFields,
    term: z.string().trim().min(1).max(255).optional(),
    status: z.enum(['complete', 'incomplete']).optional(),
    brazilianPublisherId: pageInteger.optional(),
    order: z.enum(['ASC', 'DESC']).optional()
}).strict().refine(validPage);
const wishlistQuerySchema = z.object({
    ...paginationFields,
    term: z.string().trim().min(1).max(255).optional(),
    brazilianPublisherId: pageInteger.optional(),
    order: z.enum(['ASC', 'DESC']).optional()
}).strict().refine(validPage);

export { volumeParamsSchema, editionParamsSchema, readSchema, batchSchema, paginationSchema, selectionQuerySchema, collectionQuerySchema, wishlistQuerySchema };
