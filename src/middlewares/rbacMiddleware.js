function requireRole(...allowedRoles) {
    return (req, res, next) => {
        const userRole = req.user?.role;

        if (!userRole || !allowedRoles.includes(userRole)) {
            return res.status(403).json({
                error: "Acesso negado: voce nao possui permissao para executar esta operacao."
            });
        }

        return next();
    };
}

module.exports = {
    requireRole
};
