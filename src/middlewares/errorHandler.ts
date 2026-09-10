import { safeRequestPath } from './requestLogger';
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
    if (['P2003', 'P2004'].includes(error.code || '')) {
        return res.status(409).json({ error: 'A alteração conflita com um registro associado ou uma regra do catálogo.', code: 'DATA_INTEGRITY_CONFLICT' });
    }
    const statusCode = error.statusCode || error.status || 500;
    const safeStatusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    const isServerError = safeStatusCode >= 500;
    const code = error.code || getDefaultCode(safeStatusCode);

    if (isServerError) {
        const isAuthenticationRoute = ['/activate/:token', '/register', '/resend-activation', '/forgot-password', '/reset-password', '/login'].includes(req.route?.path);
        structuredLogger.error('api.unhandled_error', {
            requestId: req.requestId || 'não informado',
            method: req.method || 'não informado',
            route: safeRequestPath(req) || 'não informada'
        }, isAuthenticationRoute ? undefined : error);
    }

    return res.status(safeStatusCode).json({
        error: isServerError ? 'Erro interno do servidor.' : error.message,
        code
    });
};

export = errorHandler;
