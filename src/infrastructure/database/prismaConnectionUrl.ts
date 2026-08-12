interface PrismaPoolEnvironment {
    PRISMA_CONNECTION_LIMIT?: string;
    PRISMA_POOL_TIMEOUT_SECONDS?: string;
}

function readPositiveInteger(value: string | undefined, fallback: number): string {
    const parsed = Number(value);
    return String(Number.isInteger(parsed) && parsed > 0 ? parsed : fallback);
}

export function configurePrismaConnectionUrl(
    databaseUrl: string,
    environment: PrismaPoolEnvironment = process.env
): string {
    const parsedUrl = new URL(databaseUrl);

    if (!parsedUrl.searchParams.has('connection_limit')) {
        parsedUrl.searchParams.set(
            'connection_limit',
            readPositiveInteger(environment.PRISMA_CONNECTION_LIMIT, 5)
        );
    }

    if (!parsedUrl.searchParams.has('pool_timeout')) {
        parsedUrl.searchParams.set(
            'pool_timeout',
            readPositiveInteger(environment.PRISMA_POOL_TIMEOUT_SECONDS, 10)
        );
    }

    return parsedUrl.toString();
}
