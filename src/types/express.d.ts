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
                profiles: string[];
                activeProfile: string;
                hasAdminAssignment: boolean;
            };
            session?: {
                id: Session['id'];
                tokenHash: string;
            };
            publicCatalogViewer?: {
                userId?: string;
                canViewAdultContent: boolean;
                hasAdminAssignment: boolean;
            };
        }
    }
}

export {};
