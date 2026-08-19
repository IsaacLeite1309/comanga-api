import type { Session } from '@prisma/client';

declare global {
    namespace Express {
        interface Request {
            requestId?: string;
            user?: {
                userId: string;
                username: string;
                email: string;
                role: string;
            };
            session?: {
                id: Session['id'];
                tokenHash: string;
            };
            publicCatalogViewer?: {
                userId?: string;
                canViewAdultContent: boolean;
            };
        }
    }
}

export {};
