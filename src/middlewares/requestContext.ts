import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const requestContext: RequestHandler = (req, res, next) => {
    const incomingRequestId = req.header('x-request-id')?.trim();
    const requestId = incomingRequestId || randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
};

export = requestContext;
