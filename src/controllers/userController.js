const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../prisma');
const mailer = require('../utils/mailer');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';
const ACCESS_DENIED_MESSAGE = "Acesso negado: Você não tem permissão para acessar ou modificar os dados deste perfil.";

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function shouldUseSecureCookie(req) {
    if (process.env.COOKIE_SECURE === 'true') return true;
    if (process.env.COOKIE_SECURE === 'false') return false;
    return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
}

function getCookieOptions(req) {
    return {
        httpOnly: true,
        secure: shouldUseSecureCookie(req),
        sameSite: process.env.COOKIE_SAME_SITE || 'strict',
        path: '/'
    };
}

function clearSessionCookie(req, res) {
    res.clearCookie(SESSION_COOKIE_NAME, getCookieOptions(req));
}

function toUserResponse(user) {
    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        conteudo_adulto: user.conteudoAdulto,
        role: user.nivelAcesso
    };
}

const registerSchema = z.object({
    username: z.string()
        .regex(/^[a-zA-Z0-9_]{3,20}$/, "Utilize entre 3 e 20 caracteres, sem espaços, acentos ou caracteres especiais."),
    email: z.string().email("E-mail com formato inválido."),
    password: z.string()
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, "Utilize no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial."),
    confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
    message: "Divergência nos valores da senha e confirmação de senha!",
    path: ["confirmPassword"]
});

exports.registerUser = async (req, res) => {
    try {
        const validation = registerSchema.safeParse(req.body);

        if (!validation.success) {
            const issue = validation.error.issues[0];
            const message = issue?.message || "Dados inválidos.";
            const fieldName = issue?.path[0] || "geral";

            return res.status(400).json({ error: message, field: fieldName });
        }

        const { username, email, password } = validation.data;

        const conflict = await prisma.user.findFirst({
            where: {
                OR: [
                    { email },
                    { username }
                ]
            },
            select: {
                email: true,
                username: true
            }
        });

        if (conflict?.email === email) {
            return res.status(409).json({
                error: "Este endereço de e-mail já está em uso. Tente fazer login ou recuperar sua senha.",
                field: "email"
            });
        }

        if (conflict?.username === username) {
            return res.status(409).json({
                error: "Este nome de usuário não está disponível. Por favor, escolha outro.",
                field: "username"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const activationToken = crypto.randomBytes(32).toString('hex');
        const activationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                activationToken,
                activationExpiresAt
            }
        });

        try {
            await mailer.sendActivationEmail(email, username, activationToken);
        } catch (mailError) {
            console.error("Erro detalhado no Nodemailer:", mailError);
            return res.status(201).json({ message: "Conta criada, mas erro ao enviar e-mail." });
        }

        return res.status(201).json({ message: "Conta criada com sucesso!" });

    } catch (error) {
        console.error("ERRO CRÍTICO:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.activateAccount = async (req, res) => {
    const { token } = req.params;

    try {
        const activationResult = await prisma.$transaction(async (tx) => {
            const user = await tx.user.findFirst({
                where: { activationToken: token },
                select: {
                    id: true,
                    activationExpiresAt: true
                }
            });

            if (!user) {
                return { error: "Link de ativação inválido!" };
            }

            if (new Date() > user.activationExpiresAt) {
                return {
                    error: "Este link de ativação expirou. Solicite um novo e-mail de ativação."
                };
            }

            await tx.user.update({
                where: { id: user.id },
                data: {
                    status: 'Ativada',
                    activationToken: null,
                    activationExpiresAt: null
                }
            });

            return { activated: true };
        });

        if (activationResult.error) {
            return res.status(400).json({ error: activationResult.error });
        }

        return res.status(200).json({
            message: "Conta ativada com sucesso!"
        });

    } catch (error) {
        console.error("ERRO CRÍTICO NA ATIVAÇÃO:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.resendActivation = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "O e-mail é obrigatório." });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                username: true,
                status: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: "Endereço de e-mail não cadastrado" });
        }

        if (user.status === 'Ativada') {
            return res.status(400).json({ error: "Este endereço de e-mail pertence a uma conta ativada." });
        }

        const newActivationToken = crypto.randomBytes(32).toString('hex');
        const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                activationToken: newActivationToken,
                activationExpiresAt: newExpiresAt
            }
        });

        try {
            await mailer.sendActivationEmail(email, user.username, newActivationToken);
        } catch (mailError) {
            console.error("Erro detalhado no Nodemailer (Reenvio):", mailError);
            return res.status(500).json({ error: "Erro ao tentar enviar o e-mail." });
        }

        return res.status(200).json({ message: "Novo link de ativação enviado com sucesso para o seu e-mail!" });

    } catch (error) {
        console.error("ERRO CRÍTICO NO REENVIO:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.loginUser = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                username: true,
                passwordHash: true,
                status: true,
                nivelAcesso: true
            }
        });

        if (!user) {
            return res.status(401).json({ error: "Credenciais inválidas!" });
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            return res.status(401).json({ error: "Credenciais inválidas!" });
        }

        if (user.status === 'Pendente') {
            return res.status(403).json({
                error: "Conta de acesso pendente. Ative a conta com o e-mail de verificação enviado anteriormente."
            });
        }

        if (user.status === 'Bloqueada') {
            return res.status(403).json({ error: "Esta conta foi bloqueada por razões de segurança." });
        }

        const sessionToken = crypto.randomBytes(48).toString('hex');
        const sessionTokenHash = hashSessionToken(sessionToken);

        await prisma.session.create({
            data: {
                userId: user.id,
                sessionTokenHash
            }
        });

        res.cookie(SESSION_COOKIE_NAME, sessionToken, getCookieOptions(req));

        return res.status(200).json({
            message: "Login realizado com sucesso!",
            user: {
                id: String(user.id),
                username: user.username,
                role: user.nivelAcesso
            }
        });

    } catch (error) {
        console.error("ERRO CRÍTICO NO LOGIN:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.getUserProfile = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                username: true,
                email: true,
                conteudoAdulto: true,
                nivelAcesso: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: "Perfil não encontrado." });
        }

        return res.status(200).json({ user: toUserResponse(user) });

    } catch (error) {
        console.error("Erro ao buscar perfil (/me):", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.getOwnUserProfile = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                username: true,
                email: true,
                conteudoAdulto: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: "Perfil não encontrado." });
        }

        return res.status(200).json({
            user: {
                username: user.username,
                email: user.email,
                conteudo_adulto: user.conteudoAdulto
            }
        });

    } catch (error) {
        console.error("Erro ao buscar perfil (/users/me):", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const targetId = req.params.id;
        const requesterId = req.user.userId;
        const requesterRole = req.user.role;

        if (requesterRole === 'Usuário Padrão' && targetId !== requesterId) {
            return res.status(403).json({ error: ACCESS_DENIED_MESSAGE });
        }

        const user = await prisma.user.findUnique({
            where: { id: targetId },
            select: {
                username: true,
                email: true,
                conteudoAdulto: true,
                status: true,
                nivelAcesso: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        return res.status(200).json({
            username: user.username,
            email: user.email,
            conteudo_adulto: user.conteudoAdulto,
            status: user.status,
            nivel_acesso: user.nivelAcesso
        });

    } catch (error) {
        console.error("Erro ao buscar perfil por ID:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.updateAdultContent = async (req, res) => {
    try {
        const { conteudo_adulto } = req.body;

        if (typeof conteudo_adulto !== 'boolean') {
            return res.status(400).json({
                error: "Formato inválido. A preferência 'conteudo_adulto' deve ser estritamente verdadeira (true) ou falsa (false)."
            });
        }

        const user = await prisma.user.update({
            where: { id: req.user.userId },
            data: { conteudoAdulto: conteudo_adulto },
            select: { conteudoAdulto: true }
        });

        return res.status(200).json({
            message: "Preferência de exibição atualizada com sucesso!",
            conteudo_adulto: user.conteudoAdulto
        });

    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: "Usuário não encontrado no banco de dados." });
        }

        console.error("Erro ao atualizar preferência +18:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.updateUserById = async (req, res) => {
    try {
        const targetId = req.params.id;
        const requesterId = req.user.userId;
        const requesterRole = req.user.role;

        if (requesterRole === 'Usuário Padrão' && targetId !== requesterId) {
            return res.status(403).json({ error: ACCESS_DENIED_MESSAGE });
        }

        return res.status(200).json({ message: "Permissão concedida. Rota de atualização genérica em construção." });

    } catch (error) {
        console.error("Erro na trava IDOR de atualização:", error);
        return res.status(500).json({ error: "Erro interno." });
    }
};

exports.logoutUser = async (req, res) => {
    try {
        await prisma.session.updateMany({
            where: {
                id: req.session.id,
                revokedAt: null
            },
            data: {
                revokedAt: new Date()
            }
        });

        clearSessionCookie(req, res);

        return res.status(200).json({ message: "Sessão encerrada com sucesso." });

    } catch (error) {
        console.error("Erro no logout:", error);
        return res.status(500).json({ error: "Erro interno ao tentar encerrar a sessão." });
    }
};
