import { z } from 'zod';
import {
    AUTHOR_ROLE_VALUES,
    EDITION_PUBLICATION_STATUS_VALUES,
    EDITION_VISIBILITY_VALUES,
    ORIGINAL_PUBLICATION_STATUS_VALUES,
    ROLE_VALUES,
    STATUS_VALUES,
    VOLUME_PRICE_CURRENCY_VALUES,
    VOLUME_RELEASE_PRECISION_VALUES,
    WORK_COUNTRY_VALUES,
    WORK_DEMOGRAPHY_VALUES,
    WORK_SORT_FIELDS,
    WORK_VISIBILITY_VALUES
} from './constants';

const listUsersQuerySchema = z.object({
    term: z.string().trim().optional(),
    role: z.enum(ROLE_VALUES).optional(),
    status: z.enum(STATUS_VALUES).optional(),
    order: z.enum(['ASC', 'DESC']).default('ASC'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(8)
});

const updateRoleSchema = z.object({
    role: z.enum(ROLE_VALUES)
});

const categoryParamSchema = z.object({
    category: z.string().trim().min(1)
});

const listOptionsQuerySchema = z.object({
    term: z.string().trim().optional(),
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
    label: z.string().trim().min(1),
    dependsOnValueIds: z.array(z.coerce.number().int().positive()).optional()
});

const workAuthorSchema = z.object({
    authorId: z.coerce.number().int().positive(),
    roles: z.array(z.enum(AUTHOR_ROLE_VALUES)).min(1)
});

const orderedWorkOptionSchema = z.union([
    z.coerce.number().int().positive(),
    z.object({
        id: z.coerce.number().int().positive(),
        position: z.coerce.number().int().min(0).optional()
    })
]);

const coverAssetIdSchema = z.string().uuid();

const createWorkSchema = z.object({
    title: z.string().trim().min(1),
    originalTitle: z.string().trim().optional().nullable(),
    originalPublicationStartYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalPublicationEndYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalVolumeCount: z.coerce.number().int().min(1).max(10000).optional().nullable(),
    directRelease: z.boolean().optional().default(false),
    typeId: z.coerce.number().int().positive(),
    country: z.enum(WORK_COUNTRY_VALUES),
    originalPublisherIds: z.array(orderedWorkOptionSchema).optional().default([]),
    originalPublicationStatus: z.enum(ORIGINAL_PUBLICATION_STATUS_VALUES),
    coverAssetId: coverAssetIdSchema.optional().nullable(),
    adultContent: z.boolean().optional().default(false),
    authors: z.array(workAuthorSchema).min(1),
    genreIds: z.array(z.coerce.number().int().positive()).optional().default([]),
    demographies: z.array(z.enum(WORK_DEMOGRAPHY_VALUES)).optional().default([]),
    magazineIds: z.array(orderedWorkOptionSchema).optional().default([])
}).strict();

const updateWorkSchema = z.object({
    title: z.string().trim().min(1).optional(),
    originalTitle: z.string().trim().optional().nullable(),
    originalPublicationStartYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalPublicationEndYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalVolumeCount: z.coerce.number().int().min(1).max(10000).optional().nullable(),
    directRelease: z.boolean().optional(),
    typeId: z.coerce.number().int().positive().optional(),
    country: z.enum(WORK_COUNTRY_VALUES).optional(),
    authors: z.array(workAuthorSchema).optional(),
    originalPublicationStatus: z.enum(ORIGINAL_PUBLICATION_STATUS_VALUES).optional().nullable(),
    coverAssetId: coverAssetIdSchema.optional().nullable(),
    adultContent: z.boolean().optional(),
    genreIds: z.array(z.coerce.number().int().positive()).optional(),
    demographies: z.array(z.enum(WORK_DEMOGRAPHY_VALUES)).optional(),
    magazineIds: z.array(orderedWorkOptionSchema).optional(),
    originalPublisherIds: z.array(orderedWorkOptionSchema).optional()
}).strict();

const updateWorkVisibilitySchema = z.object({
    visibility: z.enum(WORK_VISIBILITY_VALUES)
});

const listWorksQuerySchema = z.object({
    term: z.string().trim().optional(),
    typeId: z.coerce.number().int().positive().optional(),
    country: z.enum(WORK_COUNTRY_VALUES).optional(),
    visibility: z.enum(WORK_VISIBILITY_VALUES).optional(),
    sortBy: z.enum(WORK_SORT_FIELDS).default('title'),
    order: z.enum(['ASC', 'DESC']).default('ASC'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10)
});

const editionPayloadSchema = z.object({
    brazilianPublisherId: z.coerce.number().int().positive(),
    editionTypeId: z.coerce.number().int().positive(),
    coverTypeId: z.coerce.number().int().positive(),
    formatId: z.coerce.number().int().positive(),
    chronologicalNumber: z.coerce.number().int().positive(),
    brazilPublicationStatus: z.enum(EDITION_PUBLICATION_STATUS_VALUES),
    coverAssetId: coverAssetIdSchema.optional().nullable()
}).strict();

const updateEditionSchema = editionPayloadSchema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para alterar.'
});

const listEditionsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    order: z.enum(['ASC', 'DESC']).default('DESC')
});

const updateEditionVisibilitySchema = z.object({
    visibility: z.enum(EDITION_VISIBILITY_VALUES)
});

function normalizeIsbn(value: string) {
    return value.replace(/[\s-]/g, '').toUpperCase();
}

function isValidIsbn10(value: string) {
    const normalized = normalizeIsbn(value);
    if (!/^\d{9}[\dX]$/.test(normalized)) return false;

    const checksum = [...normalized].reduce((sum, character, index) => (
        sum + (character === 'X' ? 10 : Number(character)) * (10 - index)
    ), 0);
    return checksum % 11 === 0;
}

function isValidIsbn13(value: string) {
    const normalized = normalizeIsbn(value);
    if (!/^\d{13}$/.test(normalized)) return false;

    const checksum = [...normalized.slice(0, 12)].reduce((sum, character, index) => (
        sum + Number(character) * (index % 2 === 0 ? 1 : 3)
    ), 0);
    const expectedCheckDigit = (10 - (checksum % 10)) % 10;
    return expectedCheckDigit === Number(normalized[12]);
}

const isbn10Schema = z.string().trim().max(20).refine(isValidIsbn10, {
    message: 'ISBN-10 inválido.'
});
const isbn13Schema = z.string().trim().max(20).refine(isValidIsbn13, {
    message: 'ISBN-13 inválido.'
});

const volumePayloadBaseSchema = z.object({
    number: z.coerce.number().int().min(0),
    coverAssetId: coverAssetIdSchema,
    singleVolume: z.boolean().optional().default(false),
    pages: z.coerce.number().int().positive().optional().nullable(),
    priceCurrency: z.enum(VOLUME_PRICE_CURRENCY_VALUES).optional().default('R$'),
    price: z.coerce.number().min(0).optional().nullable(),
    releaseDatePrecision: z.enum(VOLUME_RELEASE_PRECISION_VALUES).optional(),
    releaseYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    releaseMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
    releaseDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
    isbn10: isbn10Schema.optional().nullable(),
    isbn13: isbn13Schema.optional().nullable(),
    affiliateLink: z.string().trim().url().optional().nullable(),
    synopsis: z.string().trim().optional().nullable()
}).strict();

function validateVolumeReleaseDate(
    value: {
        releaseDatePrecision?: string | null;
        releaseYear?: number | null;
        releaseMonth?: number | null;
        releaseDay?: number | null;
    },
    ctx: z.RefinementCtx
) {
    if (value.releaseDatePrecision === 'Completa' && (!value.releaseYear || !value.releaseMonth || !value.releaseDay)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['releaseDay'], message: 'Informe data completa.' });
    }

    if (value.releaseDatePrecision === 'Completa' && value.releaseYear && value.releaseMonth && value.releaseDay) {
        const date = new Date(Date.UTC(value.releaseYear, value.releaseMonth - 1, value.releaseDay));
        const isSameDate = date.getUTCFullYear() === value.releaseYear
            && date.getUTCMonth() === value.releaseMonth - 1
            && date.getUTCDate() === value.releaseDay;

        if (!isSameDate) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['releaseDay'], message: 'Informe uma data válida.' });
        }
    }

    if (value.releaseDatePrecision === 'Mes e ano' && (!value.releaseYear || !value.releaseMonth)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['releaseMonth'], message: 'Informe mes e ano.' });
    }

    if (value.releaseDatePrecision === 'Ano' && !value.releaseYear) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['releaseYear'], message: 'Informe ano.' });
    }
}

const volumePayloadSchema = volumePayloadBaseSchema.extend({
    releaseDatePrecision: z.enum(VOLUME_RELEASE_PRECISION_VALUES).default('Completa')
}).superRefine(validateVolumeReleaseDate);

const updateVolumeSchema = volumePayloadBaseSchema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para alterar.'
}).superRefine(validateVolumeReleaseDate);

const listVolumesQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    order: z.enum(['ASC', 'DESC']).default('ASC')
});

export {
    listUsersQuerySchema,
    updateRoleSchema,
    categoryParamSchema,
    listOptionsQuerySchema,
    createOptionSchema,
    updateOptionSchema,
    workAuthorSchema,
    orderedWorkOptionSchema,
    createWorkSchema,
    updateWorkSchema,
    updateWorkVisibilitySchema,
    listWorksQuerySchema,
    editionPayloadSchema,
    updateEditionSchema,
    listEditionsQuerySchema,
    updateEditionVisibilitySchema,
    volumePayloadBaseSchema,
    validateVolumeReleaseDate,
    volumePayloadSchema,
    updateVolumeSchema,
    listVolumesQuerySchema
};
