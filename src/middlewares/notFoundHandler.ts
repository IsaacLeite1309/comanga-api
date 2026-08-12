import type { RequestHandler } from 'express';
import ApplicationError from '../errors/ApplicationError';

const notFoundHandler: RequestHandler = (req, _res, next) => {
    next(new ApplicationError({
        statusCode: 404,
        code: 'ROUTE_NOT_FOUND',
        message: 'Rota não encontrada.'
    }));
};

export = notFoundHandler;
