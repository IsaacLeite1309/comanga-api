import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../prisma';

const ROLE_VALUES = ['Administrador', 'Usuário Padrão'] as const;
const STATUS_VALUES = ['Pendente', 'Ativada', 'Bloqueada'] as const;
const SELF_ROLE_CHANGE_MESSAGE = 'Você não pode alterar o nível de acesso de sua própria conta!';
const DUPLICATE_OPTION_MESSAGE = 'Essa lista já tem esse valor cadastrado!';
const OPTION_IN_USE_MESSAGE = 'Esse valor está vinculado a um mangá, não pode ser excluído!';
const AUTHOR_DUPLICATED_MESSAGE = 'Autor duplicado!';
const WORK_DUPLICATED_MESSAGE = 'Obra já cadastrada!';
const REQUIRED_WORK_FIELDS_MESSAGE = 'Preencha os campos obrigatórios da Obra.';
const INVALID_DOMAIN_REFERENCE_MESSAGE = 'Um ou mais valores selecionados são inválidos.';
const WORK_VISIBILITY_VALUES = ['Privado', 'Público'] as const;
const WORK_SORT_FIELDS = ['title', 'author', 'country', 'type', 'editions', 'visibility'] as const;
const AUTHOR_ROLE_VALUES = ['História e Arte', 'História', 'Arte', 'Criador Original', 'História Original', 'Ilustrador'] as const;
const WORK_COUNTRY_VALUES = ['Japão', 'Coreia do Sul', 'China', 'Taiwan'] as const;
const ORIGINAL_PUBLICATION_STATUS_VALUES = ['Completo', 'Em andamento', 'Em hiato', 'Cancelado'] as const;
const WORK_DEMOGRAPHY_VALUES = ['Shonen', 'Shoujo', 'Seinen', 'Josei', 'Kodomo'] as const;
const WORK_DOMAIN_CATEGORIES = {
    typeId: 'tipos-obra',
    originalPublisherId: 'editoras-originais',
    authorId: 'autores',
    genreIds: 'generos',
    magazineIds: 'revistas-serializacao'
} as const;
const COUNTRY_CATEGORY_SLUG = 'paises-origem';
const WORK_FORM_OPTION_CATEGORIES = {
    authors: 'autores',
    workTypes: 'tipos-obra',
    genres: 'generos',
    magazines: 'revistas-serializacao',
    originalPublishers: 'editoras-originais'
} as const;
const EDITION_FORM_OPTION_CATEGORIES = {
    brazilianPublishers: 'editoras-brasileiras',
    editionTypes: 'tipos-edicao',
    coverTypes: 'tipos-capa',
    formats: 'formatos-fisicos'
} as const;
const EDITION_VISIBILITY_VALUES = ['Privado', 'Público'] as const;
const EDITION_PUBLICATION_STATUS_VALUES = ['Completo', 'Em andamento', 'Em hiato', 'Cancelado'] as const;
const EDITION_DUPLICATED_MESSAGE = 'Essa Obra já possui uma Edição com esse número cronológico!';
const PRIVATE_WORK_PUBLIC_EDITION_MESSAGE = 'Essa Edição está vinculada a uma Obra privada, não pode ser publicada!';
const PUBLIC_EDITION_DELETE_MESSAGE = 'Essa Edição está pública, não pode ser excluída!';
const WORK_WITH_EDITIONS_DELETE_MESSAGE = 'Essa Obra possui Edições vinculadas, não pode ser excluída!';
const EDITION_WITH_VOLUMES_DELETE_MESSAGE = 'Essa Edição possui Volumes vinculados, não pode ser excluída!';
const VOLUME_DUPLICATED_MESSAGE = 'Um volume desta edição com esse mesmo número já foi cadastrado anteriormente!';
const PUBLIC_VOLUME_DELETE_MESSAGE = 'Essa Obra está pública, não pode ser excluída!';
const VOLUME_PRICE_CURRENCY_VALUES = ['R$', 'CR$', 'Cr$', 'NCz$', 'Cz$'] as const;
const VOLUME_RELEASE_PRECISION_VALUES = ['Completa', 'Mes e ano', 'Ano'] as const;
const COUNTRY_DEPENDENT_CATEGORY_SLUGS = new Set([
    'autores',
    'tipos-obra',
    'revistas-serializacao',
    'editoras-originais'
]);
const COUNTRY_DEPENDENCY_REQUIRED_MESSAGE = 'Selecione ao menos um país de origem relacionado.';

interface PrismaKnownError {
    code?: string;
}

interface OptionSummary {
    id: number | string;
    label: string;
}

interface WorkSummaryInput {
    id: number;
    title: string;
    originalTitle: string | null;
    visibility: string;
    adultContent: boolean;
    coverUrl: string | null;
    editionsCount?: number;
    type: OptionSummary;
    country: string;
    authors?: Array<{
        author: OptionSummary;
        roles?: Array<{
            role: string;
        }>;
    }>;
    _count?: {
        editions?: number;
    };
}

interface WorkDetailInput extends WorkSummaryInput {
    originalPublicationStartYear: number | null;
    originalPublicationEndYear: number | null;
    originalVolumeCount: number | null;
    directRelease: boolean;
    originalPublisher?: OptionSummary | null;
    originalPublishers?: Array<{
        position: number;
        publisher: OptionSummary;
    }>;
    originalPublicationStatus: string | null;
    authors?: Array<{
        author: OptionSummary;
        roles?: Array<{
            role: string;
        }>;
    }>;
    genres?: Array<{
        genre: OptionSummary;
    }>;
    demographics?: Array<{
        demography: string;
    }>;
    serializationMagazines?: Array<{
        position: number;
        magazine: OptionSummary;
    }>;
}

interface EditionInput {
    id: number;
    workId: number;
    chronologicalNumber: number;
    coverUrl: string | null;
    visibility: string;
    brazilianPublisher: OptionSummary;
    editionType: OptionSummary;
    coverType: OptionSummary;
    format: OptionSummary;
    brazilPublicationStatus: string;
    _count?: {
        volumes?: number;
    };
}

interface VolumeInput {
    id: number;
    editionId: number;
    number: number;
    coverUrl: string | null;
    singleVolume: boolean;
    pages: number | null;
    price: unknown;
    priceCurrency: string;
    releaseDatePrecision: string;
    releaseYear: number | null;
    releaseMonth: number | null;
    releaseDay: number | null;
    isbn10: string | null;
    isbn13: string | null;
    affiliateLink: string | null;
    synopsis: string | null;
    visibility: string;
}

function normalizeUser(user: {
    id: string;
    username: string;
    email: string;
    nivelAcesso: string;
    status: string;
}) {
    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        role: user.nivelAcesso,
        status: user.status
    };
}

function normalizeOptionValue(value: {
    id: number;
    label: string;
    category: {
        slug: string;
        name: string;
    };
    dependencies?: Array<{
        dependsOnValue: {
            id: number;
            label: string;
            category: {
                slug: string;
                name: string;
            };
        };
    }>;
}) {
    return {
        id: value.id,
        label: value.label,
        category: {
            slug: value.category.slug,
            name: value.category.name
        },
        depends_on: value.dependencies?.map((dependency) => ({
            id: dependency.dependsOnValue.id,
            label: dependency.dependsOnValue.label,
            category: {
                slug: dependency.dependsOnValue.category.slug,
                name: dependency.dependsOnValue.category.name
            }
        })) || []
    };
}

function normalizeOptionSummary(value: OptionSummary | null | undefined) {
    if (!value) return null;

    return {
        id: value.id,
        label: value.label
    };
}

function getAuthorRolePriority(role: string) {
    const priority = AUTHOR_ROLE_VALUES.findIndex((value) => value === role);
    return priority === -1 ? AUTHOR_ROLE_VALUES.length : priority;
}

function getAuthorHighestRolePriority(author: { roles?: Array<{ role: string }> }) {
    if (!author.roles || author.roles.length === 0) return AUTHOR_ROLE_VALUES.length;

    return Math.min(...author.roles.map((role) => getAuthorRolePriority(role.role)));
}

function sortAuthorsByRolePriority<T extends { roles?: Array<{ role: string }>; author: OptionSummary }>(authors: T[]) {
    return [...authors].sort((firstAuthor, secondAuthor) => {
        const priorityDifference = getAuthorHighestRolePriority(firstAuthor) - getAuthorHighestRolePriority(secondAuthor);

        if (priorityDifference !== 0) return priorityDifference;

        return firstAuthor.author.label.localeCompare(secondAuthor.author.label, 'pt-BR', { sensitivity: 'base' });
    });
}

function normalizeAuthorRoles(roles?: Array<{ role: string }>) {
    return [...(roles || [])]
        .map((item) => item.role)
        .sort((firstRole, secondRole) => getAuthorRolePriority(firstRole) - getAuthorRolePriority(secondRole));
}

function hasDuplicatedStrings(values: string[]) {
    return new Set(values).size !== values.length;
}

function isPublicVisibility(visibility: string) {
    return visibility === 'Público' || visibility === 'PÃºblico' || visibility === 'PÃƒÂºblico';
}

function normalizeVisibility(visibility: string) {
    return isPublicVisibility(visibility) ? 'Público' : 'Privado';
}

function normalizeWorkSummary(work: WorkSummaryInput) {
    return {
        id: work.id,
        title: work.title,
        originalTitle: work.originalTitle,
        type: normalizeOptionSummary(work.type),
        country: work.country,
        visibility: work.visibility,
        adultContent: work.adultContent,
        coverUrl: work.coverUrl,
        editionsCount: work.editionsCount ?? work._count?.editions ?? 0,
        authors: sortAuthorsByRolePriority(work.authors || []).map((item) => normalizeOptionSummary(item.author))
    };
}

function normalizeWorkDetail(work: WorkDetailInput) {
    return {
        ...normalizeWorkSummary(work),
        originalPublicationStartYear: work.originalPublicationStartYear,
        originalPublicationEndYear: work.originalPublicationEndYear,
        originalVolumeCount: work.originalVolumeCount,
        directRelease: work.directRelease,
        originalPublisher: normalizeOptionSummary(work.originalPublisher),
        originalPublishers: work.originalPublishers?.map((item) => normalizeOptionSummary(item.publisher)) || [],
        originalPublicationStatus: work.originalPublicationStatus,
        authors: sortAuthorsByRolePriority(work.authors || []).map((item) => ({
            author: normalizeOptionSummary(item.author),
            roles: normalizeAuthorRoles(item.roles)
        })) || [],
        genres: work.genres?.map((item) => normalizeOptionSummary(item.genre)) || [],
        demographics: work.demographics?.map((item) => item.demography) || [],
        serializationMagazines: work.serializationMagazines?.map((item) => normalizeOptionSummary(item.magazine)) || []
    };
}

function normalizeEdition(edition: EditionInput) {
    return {
        id: edition.id,
        workId: edition.workId,
        chronologicalNumber: edition.chronologicalNumber,
        coverUrl: edition.coverUrl,
        visibility: edition.visibility,
        brazilianPublisher: normalizeOptionSummary(edition.brazilianPublisher),
        editionType: normalizeOptionSummary(edition.editionType),
        coverType: normalizeOptionSummary(edition.coverType),
        format: normalizeOptionSummary(edition.format),
        brazilPublicationStatus: edition.brazilPublicationStatus,
        volumesCount: edition._count?.volumes ?? 0
    };
}

function normalizeVolume(volume: VolumeInput) {
    return {
        id: volume.id,
        editionId: volume.editionId,
        number: volume.number,
        coverUrl: volume.coverUrl,
        singleVolume: volume.singleVolume,
        pages: volume.pages,
        price: volume.price === null || volume.price === undefined ? null : Number(volume.price),
        priceCurrency: volume.priceCurrency,
        releaseDatePrecision: volume.releaseDatePrecision,
        releaseYear: volume.releaseYear,
        releaseMonth: volume.releaseMonth,
        releaseDay: volume.releaseDay,
        isbn10: volume.isbn10,
        isbn13: volume.isbn13,
        affiliateLink: volume.affiliateLink,
        synopsis: volume.synopsis,
        visibility: volume.visibility
    };
}

function normalizeOrderedIds(values?: Array<number | { id: number; position?: number }>) {
    return (values || [])
        .map((value, index) => (
            typeof value === 'number'
                ? { id: value, position: index }
                : { id: value.id, position: value.position ?? index }
        ))
        .sort((firstValue, secondValue) => firstValue.position - secondValue.position)
        .map((value, index) => ({ ...value, position: index }));
}

function getOrderedIds(values: Array<{ id: number; position: number }>) {
    return values.map((value) => value.id);
}

function findDuplicatedNumbers(values: number[]) {
    const seenValues = new Set<number>();
    const duplicatedValues = new Set<number>();

    values.forEach((value) => {
        if (seenValues.has(value)) {
            duplicatedValues.add(value);
            return;
        }

        seenValues.add(value);
    });

    return [...duplicatedValues];
}

async function validateOptionIdsByCategory(categorySlug: string, ids: number[]) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];

    if (uniqueIds.length === 0) {
        return true;
    }

    const count = await prisma.domainOptionValue.count({
        where: {
            id: { in: uniqueIds },
            active: true,
            category: {
                slug: categorySlug
            }
        }
    });

    return count === uniqueIds.length;
}

async function validateEditionDomainReferences(data: {
    brazilianPublisherId?: number;
    editionTypeId?: number;
    coverTypeId?: number;
    formatId?: number;
}) {
    const validations: Array<Promise<boolean>> = [];

    if (data.brazilianPublisherId) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.brazilianPublishers, [data.brazilianPublisherId]));
    }

    if (data.editionTypeId) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.editionTypes, [data.editionTypeId]));
    }

    if (data.coverTypeId) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.coverTypes, [data.coverTypeId]));
    }

    if (data.formatId) {
        validations.push(validateOptionIdsByCategory(EDITION_FORM_OPTION_CATEGORIES.formats, [data.formatId]));
    }

    const results = await Promise.all(validations);
    return results.every(Boolean);
}

async function validateWorkDomainReferences(data: {
    typeId: number;
    originalPublisherId?: number | null;
    originalPublisherIds?: number[];
    country: string;
    authors: Array<{ authorId: number; roles: string[] }>;
    genreIds: number[];
    magazineIds: number[];
}) {
    const validations = await Promise.all([
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.typeId, [data.typeId]),
        data.originalPublisherId
            ? validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.originalPublisherId, [data.originalPublisherId])
            : Promise.resolve(true),
        data.originalPublisherIds && data.originalPublisherIds.length > 0
            ? validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.originalPublisherId, data.originalPublisherIds)
            : Promise.resolve(true),
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.authorId, data.authors.map((author) => author.authorId)),
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.genreIds, data.genreIds),
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.magazineIds, data.magazineIds)
    ]);

    if (!validations.every(Boolean)) {
        return false;
    }

    return validateSelectedOptionsByCountry([
        { categorySlug: WORK_DOMAIN_CATEGORIES.typeId, ids: [data.typeId] },
        { categorySlug: WORK_DOMAIN_CATEGORIES.authorId, ids: data.authors.map((author) => author.authorId) },
        { categorySlug: WORK_DOMAIN_CATEGORIES.originalPublisherId, ids: data.originalPublisherIds || [] },
        { categorySlug: WORK_DOMAIN_CATEGORIES.magazineIds, ids: data.magazineIds }
    ], data.country);
}

function getAuthenticatedAdminId(req: Request): string {
    if (!req.user) {
        throw new Error('Usuário autenticado não encontrado na requisição.');
    }

    return req.user.userId;
}

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

const createWorkSchema = z.object({
    title: z.string().trim().min(1),
    originalTitle: z.string().trim().optional().nullable(),
    originalPublicationStartYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalPublicationEndYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalVolumeCount: z.coerce.number().int().min(1).max(10000).optional().nullable(),
    directRelease: z.boolean().optional().default(false),
    typeId: z.coerce.number().int().positive(),
    country: z.enum(WORK_COUNTRY_VALUES),
    originalPublisherId: z.coerce.number().int().positive().optional().nullable(),
    originalPublisherIds: z.array(orderedWorkOptionSchema).optional().default([]),
    originalPublicationStatus: z.enum(ORIGINAL_PUBLICATION_STATUS_VALUES),
    coverUrl: z.string().trim().url().optional().nullable(),
    adultContent: z.boolean().optional().default(false),
    authors: z.array(workAuthorSchema).min(1),
    genreIds: z.array(z.coerce.number().int().positive()).optional().default([]),
    demographies: z.array(z.enum(WORK_DEMOGRAPHY_VALUES)).optional().default([]),
    magazineIds: z.array(orderedWorkOptionSchema).optional().default([])
});

const updateWorkSchema = z.object({
    title: z.string().trim().min(1).optional(),
    originalTitle: z.string().trim().optional().nullable(),
    originalPublicationStartYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalPublicationEndYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    originalVolumeCount: z.coerce.number().int().min(1).max(10000).optional().nullable(),
    directRelease: z.boolean().optional(),
    typeId: z.coerce.number().int().positive().optional(),
    country: z.enum(WORK_COUNTRY_VALUES).optional(),
    originalPublisherId: z.coerce.number().int().positive().optional().nullable(),
    authors: z.array(workAuthorSchema).optional(),
    originalPublicationStatus: z.enum(ORIGINAL_PUBLICATION_STATUS_VALUES).optional().nullable(),
    coverUrl: z.string().trim().url().optional().nullable(),
    adultContent: z.boolean().optional(),
    genreIds: z.array(z.coerce.number().int().positive()).optional(),
    demographies: z.array(z.enum(WORK_DEMOGRAPHY_VALUES)).optional(),
    magazineIds: z.array(orderedWorkOptionSchema).optional(),
    originalPublisherIds: z.array(orderedWorkOptionSchema).optional()
});

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
    coverUrl: z.string().trim().url().optional().nullable()
});

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

const volumePayloadBaseSchema = z.object({
    number: z.coerce.number().int().min(0),
    coverUrl: z.string().trim().url(),
    singleVolume: z.boolean().optional().default(false),
    pages: z.coerce.number().int().positive().optional().nullable(),
    priceCurrency: z.enum(VOLUME_PRICE_CURRENCY_VALUES).optional().default('R$'),
    price: z.coerce.number().min(0).optional().nullable(),
    releaseDatePrecision: z.enum(VOLUME_RELEASE_PRECISION_VALUES).optional(),
    releaseYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
    releaseMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
    releaseDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
    isbn10: z.string().trim().max(20).optional().nullable(),
    isbn13: z.string().trim().max(20).optional().nullable(),
    affiliateLink: z.string().trim().url().optional().nullable(),
    synopsis: z.string().trim().optional().nullable()
});

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

async function findCategoryBySlug(slug: string) {
    return prisma.domainOptionCategory.findUnique({
        where: { slug }
    });
}

async function optionLabelExists(categoryId: number, label: string, ignoredValueId?: number) {
    const value = await prisma.domainOptionValue.findFirst({
        where: {
            categoryId,
            label: {
                equals: label,
                mode: 'insensitive'
            },
            ...(ignoredValueId ? { id: { not: ignoredValueId } } : {})
        },
        select: { id: true }
    });

    return Boolean(value);
}

function parseOptionLabels(label: string) {
    return label
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseOptionLabelsForCategory(label: string, categorySlug: string) {
    if (categorySlug === 'formatos-fisicos') {
        return [label.trim()].filter(Boolean);
    }

    return parseOptionLabels(label);
}

function findDuplicateSubmittedLabels(labels: string[]) {
    const seenLabels = new Map<string, string>();
    const duplicatedLabels = new Set<string>();

    labels.forEach((label) => {
        const normalizedLabel = label.toLocaleLowerCase('pt-BR');

        if (seenLabels.has(normalizedLabel)) {
            duplicatedLabels.add(seenLabels.get(normalizedLabel) || label);
            return;
        }

        seenLabels.set(normalizedLabel, label);
    });

    return [...duplicatedLabels];
}

async function findExistingOptionLabels(categoryId: number, labels: string[]) {
    const values = await prisma.domainOptionValue.findMany({
        where: {
            categoryId,
            OR: labels.map((label) => ({
                label: {
                    equals: label,
                    mode: 'insensitive' as const
                }
            }))
        },
        select: { label: true }
    });

    return values.map((value) => value.label);
}

function formatSubmittedDuplicateMessage(labels: string[]) {
    return `Valores repetidos na solicitação: ${labels.join(', ')}.`;
}

function formatExistingDuplicateMessage(labels: string[]) {
    if (labels.length === 1) {
        return `Essa lista já tem esse valor cadastrado: ${labels[0]}.`;
    }

    return `Essa lista já tem esses valores cadastrados: ${labels.join(', ')}.`;
}

async function validateCountryDependencies(categorySlug: string, dependsOnValueIds: number[]) {
    const uniqueIds = [...new Set(dependsOnValueIds)];

    if (!COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(categorySlug)) {
        return [];
    }

    if (uniqueIds.length === 0) {
        return { error: COUNTRY_DEPENDENCY_REQUIRED_MESSAGE };
    }

    const countries = await prisma.domainOptionValue.findMany({
        where: {
            id: { in: uniqueIds },
            active: true,
            category: {
                slug: COUNTRY_CATEGORY_SLUG
            }
        },
        select: { id: true }
    });

    if (countries.length !== uniqueIds.length) {
        return { error: 'País de origem relacionado inválido.' };
    }

    return uniqueIds;
}

async function validateSelectedOptionsByCountry(
    selections: Array<{ categorySlug: string; ids: number[] }>,
    country: string
) {
    const countryDependentSelections = selections
        .filter((selection) => COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(selection.categorySlug))
        .map((selection) => ({
            ...selection,
            ids: [...new Set(selection.ids.filter(Boolean))]
        }))
        .filter((selection) => selection.ids.length > 0);

    if (countryDependentSelections.length === 0) {
        return true;
    }

    const optionIds = countryDependentSelections.flatMap((selection) => selection.ids);
    const values = await prisma.domainOptionValue.findMany({
        where: {
            id: { in: optionIds },
            active: true
        },
        select: {
            id: true,
            dependencies: {
                select: {
                    dependsOnValue: {
                        select: {
                            label: true,
                            category: {
                                select: {
                                    slug: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    const valuesById = new Map(values.map((value) => [value.id, value]));

    return countryDependentSelections.every((selection) => selection.ids.every((id) => {
        const value = valuesById.get(id);
        if (!value) return true;

        const countryDependencies = value.dependencies.filter((dependency) => (
            dependency.dependsOnValue.category.slug === COUNTRY_CATEGORY_SLUG
        ));

        if (countryDependencies.length === 0) return true;

        return countryDependencies.some((dependency) => (
            dependency.dependsOnValue.label === country
        ));
    }));
}

function getOptionValueSelect(includeDependencies: boolean) {
    return {
        id: true,
        label: true,
        category: {
            select: {
                slug: true,
                name: true
            }
        },
        ...(includeDependencies
            ? {
                dependencies: {
                    select: {
                        dependsOnValue: {
                            select: {
                                id: true,
                                label: true,
                                category: {
                                    select: {
                                        slug: true,
                                        name: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        dependsOnValue: {
                            label: 'asc' as const
                        }
                    }
                }
            }
            : {})
    };
}

function getWorkSummaryInclude() {
    return {
        _count: {
            select: {
                editions: true
            }
        },
        type: {
            select: { id: true, label: true }
        },
        authors: {
            select: {
                author: {
                    select: { id: true, label: true }
                },
                roles: {
                    select: { role: true }
                }
            },
            orderBy: {
                author: {
                    label: 'asc' as const
                }
            }
        }
    };
}

function getEditionInclude() {
    return {
        _count: {
            select: {
                volumes: true
            }
        },
        brazilianPublisher: {
            select: { id: true, label: true }
        },
        editionType: {
            select: { id: true, label: true }
        },
        coverType: {
            select: { id: true, label: true }
        },
        format: {
            select: { id: true, label: true }
        }
    };
}

function getWorkOrderBy(sortBy: typeof WORK_SORT_FIELDS[number], order: 'ASC' | 'DESC') {
    const direction = order.toLowerCase() as 'asc' | 'desc';

    if (sortBy === 'country') {
        return { country: direction };
    }

    if (sortBy === 'type') {
        return { type: { label: direction } };
    }

    if (sortBy === 'visibility') {
        return { visibility: direction };
    }

    return { title: direction };
}

function sortWorkSummariesInMemory(
    works: ReturnType<typeof normalizeWorkSummary>[],
    sortBy: typeof WORK_SORT_FIELDS[number],
    order: 'ASC' | 'DESC'
) {
    if (!['author', 'editions'].includes(sortBy)) return works;

    return [...works].sort((firstWork, secondWork) => {
        const firstValue = sortBy === 'author'
            ? firstWork.authors.map((author) => author?.label ?? '').join(', ')
            : String((firstWork as typeof firstWork & { editionsCount?: number }).editionsCount ?? 0).padStart(10, '0');
        const secondValue = sortBy === 'author'
            ? secondWork.authors.map((author) => author?.label ?? '').join(', ')
            : String((secondWork as typeof secondWork & { editionsCount?: number }).editionsCount ?? 0).padStart(10, '0');
        const comparison = firstValue.localeCompare(secondValue, 'pt-BR', { sensitivity: 'base' });

        return order === 'ASC' ? comparison : -comparison;
    });
}

function buildWorkFormOptionQuery(categorySlug: string) {
    return prisma.domainOptionValue.findMany({
        where: {
            active: true,
            category: {
                slug: categorySlug
            }
        },
        select: getOptionValueSelect(COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(categorySlug)),
        orderBy: {
            label: 'asc'
        }
    });
}

function getWorkDetailInclude() {
    return {
        ...getWorkSummaryInclude(),
        originalPublisher: {
            select: { id: true, label: true }
        },
        originalPublishers: {
            select: {
                position: true,
                publisher: {
                    select: { id: true, label: true }
                }
            },
            orderBy: {
                position: 'asc' as const
            }
        },
        authors: {
            select: {
                author: {
                    select: { id: true, label: true }
                },
                roles: {
                    select: { role: true }
                }
            },
            orderBy: {
                author: {
                    label: 'asc' as const
                }
            }
        },
        genres: {
            select: {
                genre: {
                    select: { id: true, label: true }
                }
            },
            orderBy: {
                genre: {
                    label: 'asc' as const
                }
            }
        },
        demographics: {
            select: {
                demography: true
            },
            orderBy: {
                demography: 'asc' as const
            }
        },
        serializationMagazines: {
            select: {
                position: true,
                magazine: {
                    select: { id: true, label: true }
                }
            },
            orderBy: {
                position: 'asc' as const
            }
        }
    };
}

async function listUsers(req: Request, res: Response) {
    const validation = listUsersQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({
            error: 'Filtros de consulta inválidos.'
        });
    }

    const { term, role, status, order, page, limit } = validation.data;
    const where = {
        ...(term
            ? {
                OR: [
                    { username: { contains: term, mode: 'insensitive' as const } },
                    { email: { contains: term, mode: 'insensitive' as const } }
                ]
            }
            : {}),
        ...(role ? { nivelAcesso: role } : {}),
        ...(status ? { status } : {})
    };

    try {
        const [users, total] = await prisma.$transaction([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    username: true,
                    email: true,
                    nivelAcesso: true,
                    status: true
                },
                orderBy: {
                    username: order.toLowerCase() as 'asc' | 'desc'
                },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.user.count({ where })
        ]);

        return res.status(200).json({
            users: users.map(normalizeUser),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Erro ao listar usuarios para administracao:', error);
        return res.status(500).json({ error: 'Erro interno ao listar usuários.' });
    }
}

async function updateUserRole(req: Request, res: Response) {
    const validation = updateRoleSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Nível de acesso inválido.' });
    }

    const targetUserId = String(req.params.id);
    const authenticatedAdminId = getAuthenticatedAdminId(req);

    if (targetUserId === authenticatedAdminId) {
        return res.status(403).json({ error: SELF_ROLE_CHANGE_MESSAGE });
    }

    try {
        const user = await prisma.user.update({
            where: { id: targetUserId },
            data: { nivelAcesso: validation.data.role },
            select: {
                id: true,
                username: true,
                email: true,
                nivelAcesso: true,
                status: true
            }
        });

        return res.status(200).json({ user: normalizeUser(user) });

    } catch (error) {
        const knownError = error as PrismaKnownError;
        if (knownError.code === 'P2025') {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        console.error('Erro ao atualizar nivel de acesso:', error);
        return res.status(500).json({ error: 'Erro interno ao atualizar nível de acesso.' });
    }
}

async function getWorkFormOptions(_req: Request, res: Response) {
    try {
        const [
            authors,
            workTypes,
            genres,
            magazines,
            originalPublishers
        ] = await prisma.$transaction([
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.authors),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.workTypes),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.genres),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.magazines),
            buildWorkFormOptionQuery(WORK_FORM_OPTION_CATEGORIES.originalPublishers)
        ]);

        return res.status(200).json({
            options: {
                authors: authors.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                workTypes: workTypes.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                genres: genres.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                magazines: magazines.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                originalPublishers: originalPublishers.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                ))
            }
        });

    } catch (error) {
        console.error('Erro ao listar opções do formulário de obra:', error);
        return res.status(500).json({ error: 'Erro interno ao listar opções do formulário de Obra.' });
    }
}

async function getEditionFormOptions(_req: Request, res: Response) {
    try {
        const [
            brazilianPublishers,
            editionTypes,
            coverTypes,
            formats
        ] = await prisma.$transaction([
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.brazilianPublishers),
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.editionTypes),
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.coverTypes),
            buildWorkFormOptionQuery(EDITION_FORM_OPTION_CATEGORIES.formats)
        ]);

        return res.status(200).json({
            options: {
                brazilianPublishers: brazilianPublishers.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                editionTypes: editionTypes.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                coverTypes: coverTypes.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                )),
                formats: formats.map((value) => normalizeOptionValue(
                    value as unknown as Parameters<typeof normalizeOptionValue>[0]
                ))
            }
        });

    } catch (error) {
        console.error('Erro ao listar opções do formulário de edição:', error);
        return res.status(500).json({ error: 'Erro interno ao listar opções do formulário de Edição.' });
    }
}

async function listOptions(req: Request, res: Response) {
    const paramsValidation = categoryParamSchema.safeParse(req.params);
    const queryValidation = listOptionsQuerySchema.safeParse(req.query);

    if (!paramsValidation.success) {
        return res.status(400).json({ error: 'Categoria obrigatória.' });
    }

    if (!queryValidation.success) {
        return res.status(400).json({ error: 'Filtros de consulta inválidos.' });
    }

    const { term, dependsOn, order, page, limit } = queryValidation.data;

    try {
        const category = await findCategoryBySlug(paramsValidation.data.category);

        if (!category) {
            return res.status(404).json({ error: 'Categoria não encontrada.' });
        }

        const where = {
            categoryId: category.id,
            active: true,
            ...(dependsOn
                ? {
                    dependencies: {
                        some: {
                            dependsOnValueId: dependsOn
                        }
                    }
                }
                : {}),
            ...(term
                ? {
                    label: {
                        contains: term,
                        mode: 'insensitive' as const
                    }
                }
                : {})
        };
        const shouldSelectDependencies = COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(category.slug);

        const [values, total] = await prisma.$transaction([
            prisma.domainOptionValue.findMany({
                where,
                select: getOptionValueSelect(shouldSelectDependencies),
                orderBy: {
                    label: order.toLowerCase() as 'asc' | 'desc'
                },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.domainOptionValue.count({ where })
        ]);

        return res.status(200).json({
            category: {
                slug: category.slug,
                name: category.name
            },
            values: values.map((value) => normalizeOptionValue(
                value as unknown as Parameters<typeof normalizeOptionValue>[0]
            )),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Erro ao listar opções administrativas:', error);
        return res.status(500).json({ error: 'Erro interno ao listar opções.' });
    }
}

async function createOption(req: Request, res: Response) {
    const validation = createOptionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Categoria e texto do valor são obrigatórios.' });
    }

    const { category: categorySlug, label, dependsOnValueIds } = validation.data;

    try {
        const category = await findCategoryBySlug(categorySlug);

        if (!category) {
            return res.status(404).json({ error: 'Categoria não encontrada.' });
        }

        const labels = parseOptionLabelsForCategory(label, category.slug);

        if (labels.length === 0) {
            return res.status(400).json({ error: 'Informe ao menos um valor válido.' });
        }

        const duplicatedSubmittedLabels = findDuplicateSubmittedLabels(labels);

        if (duplicatedSubmittedLabels.length > 0) {
            return res.status(400).json({ error: formatSubmittedDuplicateMessage(duplicatedSubmittedLabels) });
        }

        const existingLabels = await findExistingOptionLabels(category.id, labels);

        if (existingLabels.length > 0) {
            return res.status(409).json({ error: formatExistingDuplicateMessage(existingLabels) });
        }

        const dependencyValidation = await validateCountryDependencies(category.slug, dependsOnValueIds);

        if ('error' in dependencyValidation) {
            return res.status(400).json({ error: dependencyValidation.error });
        }

        const shouldSelectDependencies = COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(category.slug);
        const values = await prisma.$transaction(async (tx) => {
            const createdValues = [];

            for (const itemLabel of labels) {
                const createdValue = await tx.domainOptionValue.create({
                    data: {
                        categoryId: category.id,
                        label: itemLabel
                    },
                    select: getOptionValueSelect(false)
                });

                if (dependencyValidation.length > 0) {
                    await tx.domainOptionValueDependency.createMany({
                        data: dependencyValidation.map((dependsOnValueId) => ({
                            dependentValueId: createdValue.id,
                            dependsOnValueId
                        }))
                    });
                }

                if (!shouldSelectDependencies) {
                    createdValues.push(createdValue);
                    continue;
                }

                const valueWithDependencies = await tx.domainOptionValue.findUniqueOrThrow({
                    where: { id: createdValue.id },
                    select: getOptionValueSelect(true)
                });

                createdValues.push(valueWithDependencies);
            }

            return createdValues;
        });
        const normalizedValues = values.map((value) => normalizeOptionValue(
            value as unknown as Parameters<typeof normalizeOptionValue>[0]
        ));

        return res.status(201).json({
            value: normalizedValues[0],
            values: normalizedValues
        });

    } catch (error) {
        console.error('Erro ao cadastrar opcao administrativa:', error);
        return res.status(500).json({ error: 'Erro interno ao cadastrar opção.' });
    }
}

async function updateOption(req: Request, res: Response) {
    const validation = updateOptionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Texto do novo valor é obrigatório.' });
    }

    const optionId = Number(req.params.id);

    if (!Number.isInteger(optionId) || optionId <= 0) {
        return res.status(400).json({ error: 'Formato de identificador inválido.' });
    }

    try {
        const currentValue = await prisma.domainOptionValue.findUnique({
            where: { id: optionId },
            select: {
                id: true,
                categoryId: true,
                category: {
                    select: {
                        slug: true
                    }
                }
            }
        });

        if (!currentValue) {
            return res.status(404).json({ error: 'Valor não encontrado.' });
        }

        if (await optionLabelExists(currentValue.categoryId, validation.data.label, optionId)) {
            return res.status(409).json({ error: DUPLICATE_OPTION_MESSAGE });
        }

        const dependencyIds = validation.data.dependsOnValueIds;
        let dependencyValidation: number[] | { error: string } = [];

        if (dependencyIds) {
            dependencyValidation = await validateCountryDependencies(currentValue.category.slug, dependencyIds);

            if ('error' in dependencyValidation) {
                return res.status(400).json({ error: dependencyValidation.error });
            }
        }

        const shouldSelectDependencies = COUNTRY_DEPENDENT_CATEGORY_SLUGS.has(currentValue.category.slug);
        const value = await prisma.$transaction(async (tx) => {
            const updatedValue = await tx.domainOptionValue.update({
                where: { id: optionId },
                data: {
                    label: validation.data.label
                },
                select: getOptionValueSelect(false)
            });

            if (dependencyIds) {
                await tx.domainOptionValueDependency.deleteMany({
                    where: { dependentValueId: optionId }
                });

                if (dependencyValidation.length > 0) {
                    await tx.domainOptionValueDependency.createMany({
                        data: dependencyValidation.map((dependsOnValueId) => ({
                            dependentValueId: optionId,
                            dependsOnValueId
                        }))
                    });
                }
            }

            if (!shouldSelectDependencies) {
                return updatedValue;
            }

            return tx.domainOptionValue.findUniqueOrThrow({
                where: { id: optionId },
                select: getOptionValueSelect(true)
            });
        });

        return res.status(200).json({
            value: normalizeOptionValue(value as unknown as Parameters<typeof normalizeOptionValue>[0])
        });

    } catch (error) {
        console.error('Erro ao atualizar opcao administrativa:', error);
        return res.status(500).json({ error: 'Erro interno ao atualizar opção.' });
    }
}

async function deleteOption(req: Request, res: Response) {
    const optionId = Number(req.params.id);

    if (!Number.isInteger(optionId) || optionId <= 0) {
        return res.status(400).json({ error: 'Formato de identificador inválido.' });
    }

    try {
        await prisma.domainOptionValue.delete({
            where: { id: optionId }
        });

        return res.status(200).json({ message: 'Valor excluído com sucesso.' });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2025') {
            return res.status(404).json({ error: 'Valor não encontrado.' });
        }

        if (knownError.code === 'P2003') {
            return res.status(409).json({ error: OPTION_IN_USE_MESSAGE });
        }

        console.error('Erro ao excluir opcao administrativa:', error);
        return res.status(500).json({ error: 'Erro interno ao excluir opção.' });
    }
}

async function createWork(req: Request, res: Response) {
    const validation = createWorkSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: REQUIRED_WORK_FIELDS_MESSAGE });
    }

    const data = validation.data;
    const demographies = data.directRelease ? [] : data.demographies;
    const orderedMagazines = data.directRelease ? [] : normalizeOrderedIds(data.magazineIds);
    const orderedOriginalPublishers = data.originalPublisherIds.length > 0
        ? normalizeOrderedIds(data.originalPublisherIds)
        : data.originalPublisherId
            ? normalizeOrderedIds([data.originalPublisherId])
            : [];
    const magazineIds = getOrderedIds(orderedMagazines);
    const originalPublisherIds = getOrderedIds(orderedOriginalPublishers);
    const duplicatedAuthors = findDuplicatedNumbers(data.authors.map((author) => author.authorId));

    if (duplicatedAuthors.length > 0) {
        return res.status(400).json({ error: AUTHOR_DUPLICATED_MESSAGE });
    }

    if (
        findDuplicatedNumbers(data.genreIds).length > 0
        || hasDuplicatedStrings(demographies)
        || findDuplicatedNumbers(magazineIds).length > 0
        || findDuplicatedNumbers(originalPublisherIds).length > 0
        || data.authors.some((author) => hasDuplicatedStrings(author.roles))
    ) {
        return res.status(400).json({ error: 'Valores duplicados nos vinculos da Obra.' });
    }

    if (
        data.originalPublicationStartYear
        && data.originalPublicationEndYear
        && data.originalPublicationEndYear < data.originalPublicationStartYear
    ) {
        return res.status(400).json({ error: 'O fim da publicação original não pode ser anterior ao início.' });
    }

    try {
        const duplicatedWork = await prisma.work.findFirst({
            where: {
                title: {
                    equals: data.title,
                    mode: 'insensitive'
                }
            },
            select: { id: true }
        });

        if (duplicatedWork) {
            return res.status(409).json({ error: WORK_DUPLICATED_MESSAGE });
        }

        const referencesAreValid = await validateWorkDomainReferences({
            ...data,
            originalPublisherId: originalPublisherIds[0] || null,
            originalPublisherIds,
            magazineIds
        });

        if (!referencesAreValid) {
            return res.status(400).json({ error: INVALID_DOMAIN_REFERENCE_MESSAGE });
        }

        const workId = await prisma.$transaction(async (tx) => {
            const createdWork = await tx.work.create({
                data: {
                    title: data.title,
                    originalTitle: data.originalTitle || null,
                    originalPublicationStartYear: data.originalPublicationStartYear || null,
                    originalPublicationEndYear: data.originalPublicationEndYear || null,
                    originalVolumeCount: data.originalVolumeCount || null,
                    directRelease: data.directRelease,
                    typeId: data.typeId,
                    country: data.country,
                    originalPublisherId: originalPublisherIds[0] || null,
                    originalPublicationStatus: data.originalPublicationStatus,
                    coverUrl: data.coverUrl || null,
                    adultContent: data.adultContent,
                    visibility: 'Privado',
                    authors: {
                        createMany: {
                            data: data.authors.map((author) => ({
                                authorId: author.authorId
                            }))
                        }
                    },
                    genres: {
                        createMany: {
                            data: data.genreIds.map((genreId) => ({ genreId }))
                        }
                    },
                    demographics: {
                        createMany: {
                            data: demographies.map((demography) => ({ demography }))
                        }
                    },
                    serializationMagazines: {
                        createMany: {
                            data: orderedMagazines.map((magazine) => ({
                                magazineId: magazine.id,
                                position: magazine.position
                            }))
                        }
                    },
                    originalPublishers: {
                        createMany: {
                            data: orderedOriginalPublishers.map((publisher) => ({
                                publisherId: publisher.id,
                                position: publisher.position
                            }))
                        }
                    }
                }
            });

            await tx.workAuthorRole.createMany({
                data: data.authors.flatMap((author) => (
                    author.roles.map((role) => ({
                        workId: createdWork.id,
                        authorId: author.authorId,
                        role
                    }))
                ))
            });

            return createdWork.id;
        });

        const work = await prisma.work.findUniqueOrThrow({
            where: { id: workId },
            include: getWorkDetailInclude()
        });

        return res.status(201).json({
            work: normalizeWorkDetail(work as unknown as WorkDetailInput)
        });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: WORK_DUPLICATED_MESSAGE });
        }

        console.error('Erro ao cadastrar obra:', error);
        return res.status(500).json({ error: 'Erro interno ao cadastrar Obra.' });
    }
}

async function listWorks(req: Request, res: Response) {
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
        console.error('Erro ao listar obras:', error);
        return res.status(500).json({ error: 'Erro interno ao listar Obras.' });
    }
}

async function getWorkById(req: Request, res: Response) {
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
        console.error('Erro ao consultar obra:', error);
        return res.status(500).json({ error: 'Erro interno ao consultar Obra.' });
    }
}

function parsePositiveId(value: string | string[] | undefined) {
    if (Array.isArray(value) || value === undefined) return null;

    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function validatePartialWorkDomainReferences(
    data: z.infer<typeof updateWorkSchema>,
    currentWork?: {
        country: string;
        typeId: number;
        authors: Array<{ authorId: number }>;
        originalPublishers: Array<{ publisherId: number }>;
        serializationMagazines: Array<{ magazineId: number }>;
    }
) {
    const validations: Array<Promise<boolean>> = [];

    if (data.typeId) {
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.typeId, [data.typeId]));
    }

    if (data.originalPublisherId) {
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.originalPublisherId, [data.originalPublisherId]));
    }

    if (data.originalPublisherIds && data.originalPublisherIds.length > 0) {
        const originalPublisherIds = getOrderedIds(normalizeOrderedIds(data.originalPublisherIds));
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.originalPublisherId, originalPublisherIds));
    }

    if (data.authors) {
        validations.push(validateOptionIdsByCategory(
            WORK_DOMAIN_CATEGORIES.authorId,
            data.authors.map((author) => author.authorId)
        ));
    }

    if (data.genreIds) {
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.genreIds, data.genreIds));
    }

    if (data.magazineIds) {
        const magazineIds = getOrderedIds(normalizeOrderedIds(data.magazineIds));
        validations.push(validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.magazineIds, magazineIds));
    }

    const results = await Promise.all(validations);
    if (!results.every(Boolean)) {
        return false;
    }

    if (!currentWork) {
        return true;
    }

    const country = data.country || currentWork.country;
    const typeIds = data.typeId ? [data.typeId] : [currentWork.typeId];
    const authorIds = data.authors
        ? data.authors.map((author) => author.authorId)
        : currentWork.authors.map((author) => author.authorId);
    const originalPublisherIds = data.originalPublisherIds || data.originalPublisherId !== undefined
        ? getOrderedIds(normalizeOrderedIds(data.originalPublisherIds || (data.originalPublisherId ? [data.originalPublisherId] : [])))
        : currentWork.originalPublishers.map((publisher) => publisher.publisherId);
    const magazineIds = data.magazineIds
        ? getOrderedIds(normalizeOrderedIds(data.magazineIds))
        : currentWork.serializationMagazines.map((magazine) => magazine.magazineId);

    return validateSelectedOptionsByCountry([
        { categorySlug: WORK_DOMAIN_CATEGORIES.typeId, ids: typeIds },
        { categorySlug: WORK_DOMAIN_CATEGORIES.authorId, ids: authorIds },
        { categorySlug: WORK_DOMAIN_CATEGORIES.originalPublisherId, ids: originalPublisherIds },
        { categorySlug: WORK_DOMAIN_CATEGORIES.magazineIds, ids: magazineIds }
    ], country);
}

async function updateWork(req: Request, res: Response) {
    const workId = parsePositiveId(req.params.id);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateWorkSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: REQUIRED_WORK_FIELDS_MESSAGE });
    }

    const data = validation.data;

    if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'Informe ao menos um campo para alterar.' });
    }

    const orderedOriginalPublishers = data.originalPublisherIds && data.originalPublisherIds.length > 0
        ? normalizeOrderedIds(data.originalPublisherIds)
        : data.originalPublisherId
            ? normalizeOrderedIds([data.originalPublisherId])
            : undefined;
    const originalPublisherIds = orderedOriginalPublishers
        ? getOrderedIds(orderedOriginalPublishers)
        : undefined;

    const demographies = data.directRelease ? [] : data.demographies;
    const orderedMagazines = data.directRelease
        ? []
        : data.magazineIds
            ? normalizeOrderedIds(data.magazineIds)
            : undefined;
    const magazineIds = orderedMagazines ? getOrderedIds(orderedMagazines) : undefined;

    if (data.authors && findDuplicatedNumbers(data.authors.map((author) => author.authorId)).length > 0) {
        return res.status(400).json({ error: AUTHOR_DUPLICATED_MESSAGE });
    }

    if (
        (data.genreIds && findDuplicatedNumbers(data.genreIds).length > 0)
        || (demographies && hasDuplicatedStrings(demographies))
        || (magazineIds && findDuplicatedNumbers(magazineIds).length > 0)
        || (originalPublisherIds && findDuplicatedNumbers(originalPublisherIds).length > 0)
        || (data.authors && data.authors.some((author) => hasDuplicatedStrings(author.roles)))
    ) {
        return res.status(400).json({ error: 'Valores duplicados nos vinculos da Obra.' });
    }

    if (
        data.originalPublicationStartYear
        && data.originalPublicationEndYear
        && data.originalPublicationEndYear < data.originalPublicationStartYear
    ) {
        return res.status(400).json({ error: 'O fim da publicação original não pode ser anterior ao início.' });
    }

    try {
        const existingWork = await prisma.work.findUnique({
            where: { id: workId },
            select: {
                id: true,
                country: true,
                typeId: true,
                authors: {
                    select: {
                        authorId: true
                    }
                },
                originalPublishers: {
                    select: {
                        publisherId: true
                    }
                },
                serializationMagazines: {
                    select: {
                        magazineId: true
                    }
                }
            }
        });

        if (!existingWork) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        if (data.title) {
            const duplicatedWork = await prisma.work.findFirst({
                where: {
                    id: { not: workId },
                    title: {
                        equals: data.title,
                        mode: 'insensitive'
                    }
                },
                select: { id: true }
            });

            if (duplicatedWork) {
                return res.status(409).json({ error: WORK_DUPLICATED_MESSAGE });
            }
        }

        const referencesAreValid = await validatePartialWorkDomainReferences({
            ...data,
            originalPublisherIds,
            magazineIds
        }, existingWork);

        if (!referencesAreValid) {
            return res.status(400).json({ error: INVALID_DOMAIN_REFERENCE_MESSAGE });
        }

        const updateData: Record<string, unknown> = {};

        if (data.title !== undefined) updateData.title = data.title;
        if (data.originalTitle !== undefined) updateData.originalTitle = data.originalTitle || null;
        if (data.originalPublicationStartYear !== undefined) updateData.originalPublicationStartYear = data.originalPublicationStartYear || null;
        if (data.originalPublicationEndYear !== undefined) updateData.originalPublicationEndYear = data.originalPublicationEndYear || null;
        if (data.originalVolumeCount !== undefined) updateData.originalVolumeCount = data.originalVolumeCount || null;
        if (data.directRelease !== undefined) updateData.directRelease = data.directRelease;
        if (data.typeId !== undefined) updateData.typeId = data.typeId;
        if (data.country !== undefined) updateData.country = data.country;
        if (originalPublisherIds !== undefined) updateData.originalPublisherId = originalPublisherIds[0] || null;
        if (data.originalPublicationStatus !== undefined) updateData.originalPublicationStatus = data.originalPublicationStatus;
        if (data.coverUrl !== undefined) updateData.coverUrl = data.coverUrl || null;
        if (data.adultContent !== undefined) updateData.adultContent = data.adultContent;

        const updateOperations = [
            prisma.work.update({
                where: { id: workId },
                data: updateData
            }),
            ...(data.authors
                ? [
                    prisma.workAuthorRole.deleteMany({ where: { workId } }),
                    prisma.workAuthor.deleteMany({ where: { workId } }),
                    prisma.workAuthor.createMany({
                        data: data.authors.map((author) => ({
                            workId,
                            authorId: author.authorId
                        }))
                    }),
                    prisma.workAuthorRole.createMany({
                        data: data.authors.flatMap((author) => (
                            author.roles.map((role) => ({
                                workId,
                                authorId: author.authorId,
                                role
                            }))
                        ))
                    })
                ]
                : []),
            ...(data.genreIds
                ? [
                    prisma.workGenre.deleteMany({ where: { workId } }),
                    prisma.workGenre.createMany({
                        data: data.genreIds.map((genreId) => ({ workId, genreId }))
                    })
                ]
                : []),
            ...(demographies
                ? [
                    prisma.workDemography.deleteMany({ where: { workId } }),
                    prisma.workDemography.createMany({
                        data: demographies.map((demography) => ({ workId, demography }))
                    })
                ]
                : []),
            ...(orderedMagazines !== undefined
                ? [
                    prisma.workSerializationMagazine.deleteMany({ where: { workId } }),
                    prisma.workSerializationMagazine.createMany({
                        data: orderedMagazines.map((magazine) => ({
                            workId,
                            magazineId: magazine.id,
                            position: magazine.position
                        }))
                    })
                ]
                : []),
            ...(orderedOriginalPublishers !== undefined
                ? [
                    prisma.workOriginalPublisher.deleteMany({ where: { workId } }),
                    prisma.workOriginalPublisher.createMany({
                        data: orderedOriginalPublishers.map((publisher) => ({
                            workId,
                            publisherId: publisher.id,
                            position: publisher.position
                        }))
                    })
                ]
                : [])
        ];

        await prisma.$transaction(updateOperations);

        const work = await prisma.work.findUnique({
            where: { id: workId },
            include: getWorkDetailInclude()
        });

        return res.status(200).json({
            work: normalizeWorkDetail(work as unknown as WorkDetailInput)
        });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: WORK_DUPLICATED_MESSAGE });
        }

        console.error('Erro ao alterar obra:', error);
        return res.status(500).json({ error: 'Erro interno ao alterar Obra.' });
    }
}

async function deleteWork(req: Request, res: Response) {
    const workId = parsePositiveId(req.params.id);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true, visibility: true }
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

        return res.status(200).json({ message: 'Obra excluída com sucesso.' });

    } catch (error) {
        console.error('Erro ao excluir obra:', error);
        return res.status(500).json({ error: 'Erro interno ao excluir Obra.' });
    }
}

async function updateWorkVisibility(req: Request, res: Response) {
    const workId = parsePositiveId(req.params.id);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateWorkVisibilitySchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Visibilidade invalida.' });
    }

    const visibility = normalizeVisibility(validation.data.visibility);

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true, visibility: true }
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        if (visibility === 'Privado' && isPublicVisibility(work.visibility)) {
            const publicEditionsCount = await ((prisma as unknown as {
                edition?: { count: (args: unknown) => Promise<number> }
            }).edition?.count({
                where: {
                    workId,
                    visibility: 'Público'
                }
            }) ?? Promise.resolve(0));

            if (publicEditionsCount > 0) {
                return res.status(409).json({
                    error: 'Essa Obra possui Edições públicas, não pode ser rebaixada para privada!'
                });
            }
        }

        const updatedWork = await prisma.work.update({
            where: { id: workId },
            data: { visibility },
            include: getWorkDetailInclude()
        });

        return res.status(200).json({
            work: normalizeWorkDetail(updatedWork as unknown as WorkDetailInput)
        });

    } catch (error) {
        console.error('Erro ao alterar visibilidade da obra:', error);
        return res.status(500).json({ error: 'Erro interno ao alterar visibilidade da Obra.' });
    }
}

async function createEdition(req: Request, res: Response) {
    const workId = parsePositiveId(req.params.workId);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = editionPayloadSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Preencha os campos obrigatórios da Edição.' });
    }

    const data = validation.data;

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true }
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        const referencesAreValid = await validateEditionDomainReferences(data);

        if (!referencesAreValid) {
            return res.status(400).json({ error: INVALID_DOMAIN_REFERENCE_MESSAGE });
        }

        const edition = await prisma.edition.create({
            data: {
                workId,
                brazilianPublisherId: data.brazilianPublisherId,
                editionTypeId: data.editionTypeId,
                coverTypeId: data.coverTypeId,
                formatId: data.formatId,
                chronologicalNumber: data.chronologicalNumber,
                brazilPublicationStatus: data.brazilPublicationStatus,
                coverUrl: data.coverUrl || null,
                visibility: 'Privado'
            },
            include: getEditionInclude()
        });

        return res.status(201).json({
            edition: normalizeEdition(edition as unknown as EditionInput)
        });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: EDITION_DUPLICATED_MESSAGE });
        }

        console.error('Erro ao cadastrar edição:', error);
        return res.status(500).json({ error: 'Erro interno ao cadastrar Edição.' });
    }
}

async function listEditionsByWork(req: Request, res: Response) {
    const workId = parsePositiveId(req.params.workId);

    if (!workId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = listEditionsQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: 'Filtros de consulta inválidos.' });
    }

    const { page, limit, order } = validation.data;

    try {
        const work = await prisma.work.findUnique({
            where: { id: workId },
            select: { id: true }
        });

        if (!work) {
            return res.status(404).json({ error: 'Obra não encontrada.' });
        }

        const [editions, total] = await prisma.$transaction([
            prisma.edition.findMany({
                where: { workId },
                include: getEditionInclude(),
                orderBy: { chronologicalNumber: order.toLowerCase() as 'asc' | 'desc' },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.edition.count({ where: { workId } })
        ]);

        return res.status(200).json({
            editions: editions.map((edition) => normalizeEdition(edition as unknown as EditionInput)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Erro ao listar edicoes:', error);
        return res.status(500).json({ error: 'Erro interno ao listar Edições.' });
    }
}

async function getEditionById(req: Request, res: Response) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            include: getEditionInclude()
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        return res.status(200).json({
            edition: normalizeEdition(edition as unknown as EditionInput)
        });

    } catch (error) {
        console.error('Erro ao consultar edição:', error);
        return res.status(500).json({ error: 'Erro interno ao consultar Edição.' });
    }
}

async function updateEdition(req: Request, res: Response) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateEditionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Informe ao menos um campo válido para alterar.' });
    }

    const data = validation.data;

    try {
        const existingEdition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true }
        });

        if (!existingEdition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const referencesAreValid = await validateEditionDomainReferences(data);

        if (!referencesAreValid) {
            return res.status(400).json({ error: INVALID_DOMAIN_REFERENCE_MESSAGE });
        }

        const edition = await prisma.edition.update({
            where: { id: editionId },
            data: {
                ...(data.brazilianPublisherId !== undefined ? { brazilianPublisherId: data.brazilianPublisherId } : {}),
                ...(data.editionTypeId !== undefined ? { editionTypeId: data.editionTypeId } : {}),
                ...(data.coverTypeId !== undefined ? { coverTypeId: data.coverTypeId } : {}),
                ...(data.formatId !== undefined ? { formatId: data.formatId } : {}),
                ...(data.chronologicalNumber !== undefined ? { chronologicalNumber: data.chronologicalNumber } : {}),
                ...(data.brazilPublicationStatus !== undefined ? { brazilPublicationStatus: data.brazilPublicationStatus } : {}),
                ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl || null } : {})
            },
            include: getEditionInclude()
        });

        return res.status(200).json({
            edition: normalizeEdition(edition as unknown as EditionInput)
        });

    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: EDITION_DUPLICATED_MESSAGE });
        }

        console.error('Erro ao alterar edição:', error);
        return res.status(500).json({ error: 'Erro interno ao alterar Edição.' });
    }
}

async function deleteEdition(req: Request, res: Response) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true, visibility: true }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        if (isPublicVisibility(edition.visibility)) {
            return res.status(409).json({ error: PUBLIC_EDITION_DELETE_MESSAGE });
        }

        const linkedVolumesCount = await prisma.volume.count({
            where: { editionId }
        });

        if (linkedVolumesCount > 0) {
            return res.status(409).json({ error: EDITION_WITH_VOLUMES_DELETE_MESSAGE });
        }

        await prisma.$transaction([
            prisma.edition.delete({
                where: { id: editionId }
            })
        ]);

        return res.status(200).json({ message: 'Edição excluída com sucesso.' });

    } catch (error) {
        console.error('Erro ao excluir edição:', error);
        return res.status(500).json({ error: 'Erro interno ao excluir Edição.' });
    }
}

async function assertEditionCanBecomePrivate(editionId: number) {
    // Ponto de extensão para bloquear rebaixamento quando houver volumes em estantes de usuários.
    await Promise.resolve(editionId);
}

async function updateEditionVisibility(req: Request, res: Response) {
    const editionId = parsePositiveId(req.params.id);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateEditionVisibilitySchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Visibilidade invalida.' });
    }

    const visibility = normalizeVisibility(validation.data.visibility);

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: {
                id: true,
                work: {
                    select: {
                        visibility: true
                    }
                }
            }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        if (isPublicVisibility(visibility) && !isPublicVisibility(edition.work.visibility)) {
            return res.status(409).json({ error: PRIVATE_WORK_PUBLIC_EDITION_MESSAGE });
        }

        if (visibility === 'Privado') {
            await assertEditionCanBecomePrivate(editionId);
        }

        const [updatedEdition] = await prisma.$transaction([
            prisma.edition.update({
                where: { id: editionId },
                data: { visibility },
                include: getEditionInclude()
            }),
            prisma.volume.updateMany({
                where: { editionId },
                data: { visibility }
            })
        ]);

        return res.status(200).json({
            edition: normalizeEdition(updatedEdition as unknown as EditionInput)
        });

    } catch (error) {
        console.error('Erro ao alterar visibilidade da edição:', error);
        return res.status(500).json({ error: 'Erro interno ao alterar visibilidade da Edição.' });
    }
}

function buildVolumeData(data: Partial<z.infer<typeof volumePayloadBaseSchema>>, mode: 'create' | 'update' = 'create') {
    const payload: Record<string, unknown> = {
        number: data.number,
        coverUrl: data.coverUrl === undefined ? undefined : data.coverUrl || null,
        singleVolume: data.singleVolume === undefined && mode === 'create' ? false : data.singleVolume,
        pages: data.pages ?? null,
        price: data.price ?? null,
        priceCurrency: data.priceCurrency === undefined && mode === 'create' ? 'R$' : data.priceCurrency,
        isbn10: data.isbn10 === undefined ? undefined : data.isbn10 || null,
        isbn13: data.isbn13 === undefined ? undefined : data.isbn13 || null,
        affiliateLink: data.affiliateLink === undefined ? undefined : data.affiliateLink || null,
        synopsis: data.synopsis === undefined ? undefined : data.synopsis || null
    };

    const releaseDatePrecision = data.releaseDatePrecision ?? (mode === 'create' ? 'Completa' : undefined);

    if (releaseDatePrecision !== undefined) {
        payload.releaseDatePrecision = releaseDatePrecision;
        payload.releaseYear = data.releaseYear ?? null;
        payload.releaseMonth = ['Completa', 'Mes e ano'].includes(releaseDatePrecision) ? data.releaseMonth ?? null : null;
        payload.releaseDay = releaseDatePrecision === 'Completa' ? data.releaseDay ?? null : null;
    } else {
        if ('releaseYear' in data) payload.releaseYear = data.releaseYear ?? null;
        if ('releaseMonth' in data) payload.releaseMonth = data.releaseMonth ?? null;
        if ('releaseDay' in data) payload.releaseDay = data.releaseDay ?? null;
    }

    return payload as Prisma.VolumeUncheckedUpdateInput;
}

async function createVolume(req: Request, res: Response) {
    const editionId = parsePositiveId(req.params.editionId);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = volumePayloadSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Preencha os campos obrigatórios do Volume.' });
    }

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true, visibility: true }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const volume = await prisma.volume.create({
            data: {
                editionId,
                ...buildVolumeData(validation.data),
                visibility: edition.visibility
            } as Prisma.VolumeUncheckedCreateInput
        });

        return res.status(201).json({ volume: normalizeVolume(volume as unknown as VolumeInput) });
    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: VOLUME_DUPLICATED_MESSAGE });
        }

        console.error('Erro ao cadastrar volume:', error);
        return res.status(500).json({ error: 'Erro interno ao cadastrar Volume.' });
    }
}

async function listVolumesByEdition(req: Request, res: Response) {
    const editionId = parsePositiveId(req.params.editionId);

    if (!editionId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = listVolumesQuerySchema.safeParse(req.query);

    if (!validation.success) {
        return res.status(400).json({ error: 'Filtros de consulta inválidos.' });
    }

    const { page, limit, order } = validation.data;

    try {
        const edition = await prisma.edition.findUnique({
            where: { id: editionId },
            select: { id: true }
        });

        if (!edition) {
            return res.status(404).json({ error: 'Edição não encontrada.' });
        }

        const [volumes, total] = await prisma.$transaction([
            prisma.volume.findMany({
                where: { editionId },
                orderBy: { number: order.toLowerCase() as 'asc' | 'desc' },
                skip: (page - 1) * limit,
                take: limit
            }),
            prisma.volume.count({ where: { editionId } })
        ]);

        return res.status(200).json({
            volumes: volumes.map((volume) => normalizeVolume(volume as unknown as VolumeInput)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Erro ao listar volumes:', error);
        return res.status(500).json({ error: 'Erro interno ao listar Volumes.' });
    }
}

async function getVolumeById(req: Request, res: Response) {
    const volumeId = parsePositiveId(req.params.id);

    if (!volumeId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const volume = await prisma.volume.findUnique({
            where: { id: volumeId }
        });

        if (!volume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }

        return res.status(200).json({ volume: normalizeVolume(volume as unknown as VolumeInput) });
    } catch (error) {
        console.error('Erro ao consultar volume:', error);
        return res.status(500).json({ error: 'Erro interno ao consultar Volume.' });
    }
}

async function updateVolume(req: Request, res: Response) {
    const volumeId = parsePositiveId(req.params.id);

    if (!volumeId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    const validation = updateVolumeSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: 'Informe ao menos um campo valido para alterar.' });
    }

    try {
        const existingVolume = await prisma.volume.findUnique({
            where: { id: volumeId },
            select: { id: true }
        });

        if (!existingVolume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }

        const volume = await prisma.volume.update({
            where: { id: volumeId },
            data: buildVolumeData(validation.data, 'update')
        });

        return res.status(200).json({ volume: normalizeVolume(volume as unknown as VolumeInput) });
    } catch (error) {
        const knownError = error as PrismaKnownError;

        if (knownError.code === 'P2002') {
            return res.status(409).json({ error: VOLUME_DUPLICATED_MESSAGE });
        }

        console.error('Erro ao alterar volume:', error);
        return res.status(500).json({ error: 'Erro interno ao alterar Volume.' });
    }
}

async function deleteVolume(req: Request, res: Response) {
    const volumeId = parsePositiveId(req.params.id);

    if (!volumeId) {
        return res.status(400).json({ error: 'Formato de identificador invalido.' });
    }

    try {
        const volume = await prisma.volume.findUnique({
            where: { id: volumeId },
            select: { id: true, visibility: true }
        });

        if (!volume) {
            return res.status(404).json({ error: 'Volume não encontrado.' });
        }

        if (isPublicVisibility(volume.visibility)) {
            return res.status(409).json({ error: PUBLIC_VOLUME_DELETE_MESSAGE });
        }

        await prisma.volume.delete({
            where: { id: volumeId }
        });

        return res.status(200).json({ message: 'Volume excluido com sucesso.' });
    } catch (error) {
        console.error('Erro ao excluir volume:', error);
        return res.status(500).json({ error: 'Erro interno ao excluir Volume.' });
    }
}

export = {
    listUsers,
    updateUserRole,
    getWorkFormOptions,
    getEditionFormOptions,
    listOptions,
    createOption,
    updateOption,
    deleteOption,
    createWork,
    listWorks,
    getWorkById,
    updateWork,
    deleteWork,
    updateWorkVisibility,
    createEdition,
    listEditionsByWork,
    getEditionById,
    updateEdition,
    deleteEdition,
    updateEditionVisibility,
    createVolume,
    listVolumesByEdition,
    getVolumeById,
    updateVolume,
    deleteVolume
};
