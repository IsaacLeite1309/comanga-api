import type { RequestHandler } from 'express';

export function createRecoveryRateLimiter(now = Date.now): RequestHandler {
    const attempts = new Map<string, { count: number; expiresAt: number }>();
    return (req, res, next) => {
        const time = now();
        for (const [key, value] of attempts) if (value.expiresAt <= time) attempts.delete(key);
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const state = attempts.get(ip);
        if ((state && state.count >= 5) || (!state && attempts.size >= 10_000)) {
            res.setHeader('Retry-After', '900');
            return res.status(429).json({ error: 'Muitas solicitações. Tente novamente em alguns minutos.', code: 'RECOVERY_RATE_LIMITED' });
        }
        attempts.set(ip, { count: (state?.count || 0) + 1, expiresAt: state?.expiresAt || time + 15 * 60 * 1000 });
        return next();
    };
}
