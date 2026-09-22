import type { NextFunction, Request, Response } from 'express';

// Autoriza somente quando o perfil ATIVO da sessão está entre os permitidos
// e a conta ainda possui a atribuição correspondente.
function requireRole(...allowedRoles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const activeProfile = req.user?.activeProfile;
        const assignedProfiles = req.user?.profiles || [];
        const authorized = Boolean(activeProfile)
            && allowedRoles.includes(String(activeProfile))
            && assignedProfiles.includes(String(activeProfile));
        if (!authorized) {
            return res.status(403).json({
                error: 'Acesso negado: voce nao possui permissao para executar esta operacao.'
            });
        }
        return next();
    };
}

export { requireRole };
