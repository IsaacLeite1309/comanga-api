import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { GENRE_CATEGORY_SLUG, HENTAI_GENRE_CODE } from '../../utils/domainOptionCodes';

// Política única de leitura de conteúdo adulto (seção 14 do guia). Todas as
// consultas públicas passam por aqui; nenhuma repete a regra por conta própria.
function canViewAdultContent(req: Request): boolean {
    const viewer = req.publicCatalogViewer;
    if (!viewer) return false;
    // Atribuição Administrador vigente dispensa idade, preferência e perfil ativo.
    return viewer.canViewAdultContent === true || viewer.hasAdminAssignment === true;
}

const hentaiGenreFilter = {
    code: HENTAI_GENRE_CODE,
    category: { slug: GENRE_CATEGORY_SLUG }
} satisfies Prisma.DomainOptionValueWhereInput;

// Sem autorização, a Obra é ocultada pela flag adulta E pela associação ao gênero
// Hentai, para que uma inconsistência legada entre os dois não vaze o registro.
function buildAdultWorkRestriction(canView: boolean): Prisma.WorkWhereInput {
    if (canView) return {};

    return {
        adultContent: false,
        genres: { none: { genre: hentaiGenreFilter } }
    };
}

function isRestrictedAdultOption(option: { code?: string | null }, canView: boolean): boolean {
    return !canView && option.code === HENTAI_GENRE_CODE;
}

export {
    buildAdultWorkRestriction,
    canViewAdultContent,
    hentaiGenreFilter,
    isRestrictedAdultOption
};
