import type { Response } from 'express';

export { INVALID_PUBLIC_FILTERS_MESSAGE, INVALID_PUBLIC_PARAMETERS_MESSAGE, pagination, prepareViewerDependentResponse };

const INVALID_PUBLIC_FILTERS_MESSAGE = 'Filtros de consulta inválidos.';

const INVALID_PUBLIC_PARAMETERS_MESSAGE = 'Parâmetros de consulta inválidos.';

function pagination(page: number, limit: number, total: number) {
    return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
    };
}

function prepareViewerDependentResponse(res: Response) {
    res.vary('Cookie');
    res.set('Cache-Control', 'private, no-store');
}
