import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import prisma from '../../prisma';
import structuredLogger, { type StructuredLogger } from '../logging/structuredLogger';

type DatabaseTimeResult = Array<{ hora_atual: Date }>;
type DatabaseConnectionsResult = Array<{ connections: number }>;

interface RuntimeMetrics {
    process: {
        cpuUserMicros: number;
        cpuSystemMicros: number;
        rssBytes: number;
        heapUsedBytes: number;
    };
    database: {
        connections: number;
    };
}

interface HealthRouterOptions {
    checkDatabase?: () => Promise<Date>;
    logger?: StructuredLogger;
    metricsToken?: string;
    now?: () => Date;
    readMetrics?: () => Promise<RuntimeMetrics>;
    uptime?: () => number;
}

async function defaultDatabaseCheck(): Promise<Date> {
    const result = await prisma.$queryRaw<DatabaseTimeResult>`SELECT NOW() AS hora_atual`;
    return result[0].hora_atual;
}

async function defaultRuntimeMetrics(): Promise<RuntimeMetrics> {
    const [connections] = await prisma.$queryRaw<DatabaseConnectionsResult>`
        SELECT COUNT(*)::int AS connections
        FROM pg_stat_activity
        WHERE datname = current_database()
    `;
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();

    return {
        process: {
            cpuUserMicros: cpu.user,
            cpuSystemMicros: cpu.system,
            rssBytes: memory.rss,
            heapUsedBytes: memory.heapUsed
        },
        database: {
            connections: connections.connections
        }
    };
}

function hasValidToken(received: string | undefined, expected: string): boolean {
    if (!received) return false;
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length
        && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function createHealthRouter(options: HealthRouterOptions = {}): Router {
    const router = Router();
    const checkDatabase = options.checkDatabase || defaultDatabaseCheck;
    const logger = options.logger || structuredLogger;
    const metricsToken = options.metricsToken ?? process.env.OPS_METRICS_TOKEN;
    const now = options.now || (() => new Date());
    const readMetrics = options.readMetrics || defaultRuntimeMetrics;
    const uptime = options.uptime || (() => process.uptime());

    router.get('/live', (req: Request, res: Response) => {
        res.json({
            status: 'alive',
            requestId: req.requestId,
            timestamp: now().toISOString(),
            uptimeSeconds: Math.floor(uptime())
        });
    });

    router.get('/ready', async (req: Request, res: Response) => {
        try {
            const databaseTime = await checkDatabase();
            return res.json({
                status: 'ready',
                requestId: req.requestId,
                timestamp: now().toISOString(),
                checks: { database: 'up' },
                databaseTime: databaseTime.toISOString()
            });
        } catch (error) {
            logger.error('health.readiness.failed', {
                requestId: req.requestId || 'not-provided',
                check: 'database'
            }, error);

            return res.status(503).json({
                status: 'unavailable',
                code: 'DATABASE_UNAVAILABLE',
                requestId: req.requestId,
                timestamp: now().toISOString(),
                checks: { database: 'down' }
            });
        }
    });

    router.get('/metrics', async (req: Request, res: Response) => {
        if (!metricsToken) {
            return res.status(404).json({
                error: 'Rota não encontrada.',
                code: 'ROUTE_NOT_FOUND'
            });
        }

        if (!hasValidToken(req.header('x-ops-token'), metricsToken)) {
            return res.status(403).json({
                error: 'Acesso operacional negado.',
                code: 'OPS_ACCESS_DENIED'
            });
        }

        try {
            return res.json({
                timestamp: now().toISOString(),
                ...(await readMetrics())
            });
        } catch (error) {
            logger.error('health.metrics.failed', {
                requestId: req.requestId || 'not-provided'
            }, error);
            return res.status(503).json({
                error: 'Métricas operacionais indisponíveis.',
                code: 'OPS_METRICS_UNAVAILABLE'
            });
        }
    });

    return router;
}

export default createHealthRouter();
