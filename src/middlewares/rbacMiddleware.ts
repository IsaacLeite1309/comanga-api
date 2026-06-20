import type { NextFunction, Request, Response } from 'express';

function requireRole(...allowedRoles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const userRole = req.user?.role;

        if (!userRole || !allowedRoles.includes(userRole)) {
            return res.status(403).json({
                error: 'Acesso negado: voce nao possui permissao para executar esta operacao.'
            });
        }

        return next();
    };
}

export = {
    requireRole
};
