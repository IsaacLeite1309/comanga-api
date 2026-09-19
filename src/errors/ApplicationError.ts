interface ApplicationErrorOptions {
    statusCode: number;
    code: string;
    message: string;
    cause?: unknown;
}

class ApplicationError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor({ statusCode, code, message, cause }: ApplicationErrorOptions) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'ApplicationError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export = ApplicationError;
