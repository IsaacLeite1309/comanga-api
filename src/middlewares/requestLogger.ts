import type { RequestHandler } from 'express';
import structuredLogger, { type StructuredLogger } from '../infrastructure/logging/structuredLogger';

interface RequestLoggerOptions {
    logger?: StructuredLogger;
    now?: () => number;
}

export function createRequestLogger(options: RequestLoggerOptions = {}): RequestHandler {
    const logger = options.logger || structuredLogger;
    const now = options.now || Date.now;

    return (req, res, next) => {
        const startedAt = now();

        res.on('finish', () => {
            logger.info('http.request.completed', {
                requestId: req.requestId || 'not-provided',
                method: req.method,
                route: req.originalUrl || req.url,
                statusCode: res.statusCode,
                durationMs: Math.max(0, now() - startedAt),
                ip: req.ip || req.socket.remoteAddress || 'not-provided'
            });
        });

        next();
    };
}

const requestLogger = createRequestLogger();

export default requestLogger;
