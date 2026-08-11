import type { ErrorRequestHandler } from 'express';

interface HttpError extends Error {
    status?: number;
    statusCode?: number;
    code?: string;
}

const errorHandler: ErrorRequestHandler = (error: HttpError, _req, res, _next) => {
    const statusCode = error.statusCode || error.status || 500;
    const safeStatusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    const isServerError = safeStatusCode >= 500;

    console.error('Erro nao tratado pela API:', error);

    return res.status(safeStatusCode).json({
        error: isServerError ? 'Erro interno do servidor.' : error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(isServerError ? { code: error.code || 'INTERNAL_SERVER_ERROR' } : {})
    });
};

export = errorHandler;
