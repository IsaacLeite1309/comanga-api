import app = require('./app');
import prisma = require('./prisma');
import structuredLogger from './infrastructure/logging/structuredLogger';
import { installGracefulShutdown } from './infrastructure/operations/gracefulShutdown';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    structuredLogger.info('server.started', { port: Number(PORT) || PORT });
});

installGracefulShutdown({
    server,
    disconnect: () => prisma.$disconnect(),
    timeoutMs: Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS) || 10000
});
