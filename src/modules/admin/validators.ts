import type { Request } from 'express';
import prisma from '../../prisma';
import { EDITION_FORM_OPTION_CATEGORIES, WORK_DOMAIN_CATEGORIES } from './constants';
import { validateSelectedOptionsByCountry } from './optionServices';

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
    originalPublisherIds?: number[];
    country: string;
    authors: Array<{ authorId: number; roles: string[] }>;
    genreIds: number[];
    magazineIds: number[];
}) {
    const validations = await Promise.all([
        validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.typeId, [data.typeId]),
        data.originalPublisherIds && data.originalPublisherIds.length > 0
            ? validateOptionIdsByCategory(WORK_DOMAIN_CATEGORIES.originalPublishers, data.originalPublisherIds)
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
        { categorySlug: WORK_DOMAIN_CATEGORIES.originalPublishers, ids: data.originalPublisherIds || [] },
        { categorySlug: WORK_DOMAIN_CATEGORIES.magazineIds, ids: data.magazineIds }
    ], data.country);
}

function getAuthenticatedAdminId(req: Request): string {
    if (!req.user) {
        throw new Error('Usuário autenticado não encontrado na requisição.');
    }

    return req.user.userId;
}

function parsePositiveId(value: string | string[] | undefined) {
    if (Array.isArray(value) || value === undefined) return null;

    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export {
    validateOptionIdsByCategory,
    validateEditionDomainReferences,
    validateWorkDomainReferences,
    getAuthenticatedAdminId,
    parsePositiveId
};
