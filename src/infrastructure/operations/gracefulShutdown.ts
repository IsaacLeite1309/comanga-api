import type { Server } from 'node:http';
import structuredLogger, { type StructuredLogger } from '../logging/structuredLogger';

type ShutdownSignal = 'SIGTERM' | 'SIGINT';

interface ManagedServer extends Pick<Server, 'close'> {
    closeIdleConnections?: () => void;
    closeAllConnections?: () => void;
}

interface ProcessController {
    once(signal: ShutdownSignal, listener: () => void): unknown;
    exit(code?: number): unknown;
    exitCode?: number;
}

interface GracefulShutdownOptions {
    server: ManagedServer;
    disconnect: () => Promise<void>;
    processRef?: ProcessController;
    logger?: StructuredLogger;
    timeoutMs?: number;
}

export function installGracefulShutdown(options: GracefulShutdownOptions) {
    const processRef = options.processRef || process;
    const logger = options.logger || structuredLogger;
    const timeoutMs = options.timeoutMs || 10000;
    let shutdownPromise: Promise<void> | undefined;

    function shutdown(signal: ShutdownSignal): Promise<void> {
        if (shutdownPromise) return shutdownPromise;

        shutdownPromise = (async () => {
            logger.info('server.shutdown.started', { signal, timeoutMs });

            const forceTimer = setTimeout(() => {
                logger.error('server.shutdown.forced', { signal, timeoutMs });
                options.server.closeAllConnections?.();
                processRef.exit(1);
            }, timeoutMs);
            forceTimer.unref?.();

            try {
                const httpClosed = new Promise<void>((resolve, reject) => {
                    options.server.close((error?: Error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });

                options.server.closeIdleConnections?.();
                await httpClosed;
                await options.disconnect();
                processRef.exitCode = 0;
                logger.info('server.shutdown.completed', { signal });
            } catch (error) {
                processRef.exitCode = 1;
                logger.error('server.shutdown.failed', { signal }, error);
            } finally {
                clearTimeout(forceTimer);
            }
        })();

        return shutdownPromise;
    }

    processRef.once('SIGTERM', () => { void shutdown('SIGTERM'); });
    processRef.once('SIGINT', () => { void shutdown('SIGINT'); });

    return { shutdown };
}
