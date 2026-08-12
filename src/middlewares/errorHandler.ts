import type { ErrorRequestHandler } from 'express';
import structuredLogger from '../infrastructure/logging/structuredLogger';

interface HttpError extends Error {
    status?: number;
    statusCode?: number;
    code?: string;
}

function getDefaultCode(statusCode: number) {
    if (statusCode === 400) return 'BAD_REQUEST';
    if (statusCode === 401) return 'UNAUTHORIZED';
    if (statusCode === 403) return 'FORBIDDEN';
    if (statusCode === 404) return 'NOT_FOUND';
    if (statusCode === 409) return 'CONFLICT';
    if (statusCode === 429) return 'TOO_MANY_REQUESTS';
    return 'INTERNAL_SERVER_ERROR';
}

const errorHandler: ErrorRequestHandler = (error: HttpError, req, res, _next) => {
    const statusCode = error.statusCode || error.status || 500;
    const safeStatusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    const isServerError = safeStatusCode >= 500;
    const code = error.code || getDefaultCode(safeStatusCode);

    if (isServerError) {
        structuredLogger.error('api.unhandled_error', {
            requestId: req.requestId || 'não informado',
            method: req.method || 'não informado',
            route: req.originalUrl || req.url || 'não informada'
        }, error);
    }

    return res.status(safeStatusCode).json({
        error: isServerError ? 'Erro interno do servidor.' : error.message,
        code
    });
};

export = errorHandler;
