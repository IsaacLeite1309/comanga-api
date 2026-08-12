type LogContext = Record<string, unknown>;

export interface StructuredLogger {
    info(event: string, context?: LogContext): void;
    error(event: string, context?: LogContext, error?: unknown): void;
}

interface LoggerOptions {
    environment?: string;
    writeInfo?: (line: string) => void;
    writeError?: (line: string) => void;
    now?: () => Date;
}

function serializeError(error: unknown, includeStack: boolean): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            ...(includeStack && error.stack ? { stack: error.stack } : {})
        };
    }

    return { message: String(error) };
}

export function createStructuredLogger(options: LoggerOptions = {}): StructuredLogger {
    const environment = options.environment || process.env.NODE_ENV || 'development';
    const writeInfo = options.writeInfo || ((line: string) => console.log(line));
    const writeError = options.writeError || ((line: string) => console.error(line));
    const now = options.now || (() => new Date());

    function createPayload(level: 'info' | 'error', event: string, context: LogContext) {
        return {
            ...context,
            timestamp: now().toISOString(),
            level,
            event
        };
    }

    return {
        info(event, context = {}) {
            writeInfo(JSON.stringify(createPayload('info', event, context)));
        },
        error(event, context = {}, error) {
            const payload = createPayload('error', event, context);
            writeError(JSON.stringify({
                ...payload,
                ...(error === undefined
                    ? {}
                    : { error: serializeError(error, environment !== 'production') })
            }));
        }
    };
}

const structuredLogger = createStructuredLogger();

export default structuredLogger;
