const db = require('../database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { z } = require('zod');
const mailer = require('../utils/mailer');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'comanga_session';

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
            const fieldName = issue?.path[0] || "geral"; // NOVO: Captura qual campo falhou no Zod
            
            return res.status(400).json({ error: message, field: fieldName }); // NOVO: Retorna o campo
        }

        const { username, email, password } = validation.data;

        const checkQuery = await db.query(
            'SELECT username, email FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );

        if (checkQuery.rows.length > 0) {
            const conflict = checkQuery.rows[0];
            if (conflict.email === email) {
                // NOVO: Adicionado field: 'email'
                return res.status(409).json({ error: "Este endereço de e-mail já está em uso. Tente fazer login ou recuperar sua senha.", field: "email" });
            }
            if (conflict.username === username) {
                // NOVO: Adicionado field: 'username'
                return res.status(409).json({ error: "Este nome de usuário não está disponível. Por favor, escolha outro.", field: "username" });
            }
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const activationToken = crypto.randomBytes(32).toString('hex');
        
        // NOVO: Calcula 24 horas a partir de agora (Garante a RN0007)
        const activationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // MODIFICADO: Atualizamos o INSERT para salvar a nova coluna de expiração
        await db.query(
            `INSERT INTO users (username, email, password_hash, activation_token, activation_expires_at) VALUES ($1, $2, $3, $4, $5)`,
            [username, email, passwordHash, activationToken, activationExpiresAt]
        );

        try {
            await mailer.sendActivationEmail(email, username, activationToken);
        } catch (mailError) {
            console.error("Erro detalhado no Nodemailer:", mailError); // NOVO
            return res.status(201).json({ message: "Conta criada, mas erro ao enviar e-mail." });
        }

        return res.status(201).json({ message: "Conta criada com sucesso!" });

    } catch (error) {
        console.error("ERRO CRÍTICO:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.activateAccount = async (req, res) => {
    // Checklist 1: A rota captura o token via parâmetro da URL
    const { token } = req.params;
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // Checklist 2: Busca no banco de dados pelo token informado
        const result = await client.query(
            'SELECT id, activation_expires_at FROM users WHERE activation_token = $1 FOR UPDATE',
            [token]
        );

        // Cenário Alternativo 2: Falha por token já utilizado ou inválido
        // RN0008: Se o token for nulo (já usado) ou falso, não achará nenhuma linha
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Link de ativação inválido!" }); // Ajustado para a string exata do QA
        }

        const user = result.rows[0];

        // Checklist 3: Verificação condicional de tempo (RN0007)
        // Cenário Alternativo 1: Falha por token expirado
        const now = new Date();
        if (now > user.activation_expires_at) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: "Este link de ativação expirou. Solicite um novo e-mail de ativação." 
            });
        }

        // Checklist 4: Atualização do status e remoção do token (Caminho Feliz)
        await client.query(
            `UPDATE users 
             SET status = 'Ativada', 
                 activation_token = NULL, 
                 activation_expires_at = NULL 
             WHERE id = $1`,
            [user.id]
        );

        await client.query('COMMIT');

        // Retorna HTTP 200 (OK) conforme o Critério de Aceite
        return res.status(200).json({ 
            message: "Conta ativada com sucesso!" 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERRO CRÍTICO NA ATIVAÇÃO:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    } finally {
        client.release();
    }
};

exports.resendActivation = async (req, res) => {
    // O e-mail virá no corpo da requisição (JSON)
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "O e-mail é obrigatório." });
    }

    try {
        // Checklist 2: Busca no banco de dados
        const result = await db.query(
            'SELECT id, username, status FROM users WHERE email = $1',
            [email]
        );

        // Cenário Alternativo 1 (RN0009): E-mail inexistente
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Endereço de e-mail não cadastrado" });
        }

        const user = result.rows[0];

        // Cenário Alternativo 2 (RN0010): Conta já ativada
        // Checklist 3: Trava de Validação
        if (user.status === 'Ativada') {
            return res.status(400).json({ error: "Este endereço de e-mail pertence a uma conta ativada." });
        }

        // Checklist 4: Geração do novo token criptográfico (Sobrescrita / RN0011)
        const newActivationToken = crypto.randomBytes(32).toString('hex');
        const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24 horas

        await db.query(
            `UPDATE users 
             SET activation_token = $1, 
                 activation_expires_at = $2 
             WHERE id = $3`,
            [newActivationToken, newExpiresAt, user.id]
        );

        // Disparo via SMTP com Nodemailer
        try {
            await mailer.sendActivationEmail(email, user.username, newActivationToken);
        } catch (mailError) {
            console.error("❌ Erro detalhado no Nodemailer (Reenvio):", mailError);
            return res.status(500).json({ error: "Erro ao tentar enviar o e-mail." });
        }

        // Caminho Feliz: Sucesso e HTTP 200
        return res.status(200).json({ message: "Novo link de ativação enviado com sucesso para o seu e-mail!" });

    } catch (error) {
        console.error("🔥 ERRO CRÍTICO NO REENVIO:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.loginUser = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
    }

    try {
        // Checklist 2: Busca no banco pelo e-mail
        const result = await db.query(
            'SELECT id, username, password_hash, status, nivel_acesso FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais inválidas!" });
        }

        const user = result.rows[0];

        // Checklist 2: Validação da senha com bcrypt
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: "Credenciais inválidas!" });
        }

        // Checklist 3: Trava de Validação de Status (RN0013)
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

        await db.query(
            `INSERT INTO sessions (user_id, session_token_hash)
             VALUES ($1, $2)`,
            [user.id, sessionTokenHash]
        );

        res.cookie(SESSION_COOKIE_NAME, sessionToken, getCookieOptions(req));

        // Sucesso
        return res.status(200).json({ 
            message: "Login realizado com sucesso!", 
            user: {
                id: String(user.id),
                username: user.username,
                role: user.nivel_acesso
            }
        });

    } catch (error) {
        console.error("ERRO CRÍTICO NO LOGIN:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.getUserProfile = async (req, res) => {
    try {
        // O ID vem da sessao validada pelo middleware.
        const userId = req.user.userId; 

        // Projeção de Dados: Retornando ESTRITAMENTE o que o cartão pediu
        const result = await db.query(
            'SELECT id, username, email, conteudo_adulto, nivel_acesso FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Perfil não encontrado." });
        }

        const user = result.rows[0];
        return res.status(200).json({
            user: {
                id: String(user.id),
                username: user.username,
                email: user.email,
                conteudo_adulto: user.conteudo_adulto,
                role: user.nivel_acesso
            }
        });

    } catch (error) {
        console.error("Erro ao buscar perfil (/me):", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

// CHECKLIST 4: Proteção contra IDOR na Rota /:id (RN0022)
exports.getUserById = async (req, res) => {
    try {
        const targetId = req.params.id; // O ID que o usuário tentou acessar na URL
        const requesterId = req.user.userId; // O ID real de quem fez a requisição (do JWT)
        const requesterRole = req.user.role; // O Nível de Acesso (do JWT)

        // A Trava IDOR: Se não for Administrador e tentar ver o ID de outro, bloqueia.
        if (requesterRole === 'Usuário Padrão' && targetId !== requesterId) {
            return res.status(403).json({ 
                error: "Acesso negado: Você não tem permissão para acessar ou modificar os dados deste perfil." 
            });
        }

        // Se passou pela trava (é o próprio usuário ou é um Admin), busca os dados
        const result = await db.query(
            'SELECT username, email, conteudo_adulto, status, nivel_acesso FROM users WHERE id = $1',
            [targetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        return res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error("Erro ao buscar perfil por ID:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.updateAdultContent = async (req, res) => {
    try {
        // Checklist 2: O ID vem 100% do Token JWT, impossibilitando que o usuário altere a conta do vizinho.
        const userId = req.user.userId; 
        
        const { conteudo_adulto } = req.body;

        // Checklist 3: Validação de Tipo Estrita
        if (typeof conteudo_adulto !== 'boolean') {
            return res.status(400).json({ 
                error: "Formato inválido. A preferência 'conteudo_adulto' deve ser estritamente verdadeira (true) ou falsa (false)." 
            });
        }

        // Checklist 4: Execução da instrução SQL de UPDATE
        const result = await db.query(
            `UPDATE users 
             SET conteudo_adulto = $1 
             WHERE id = $2 
             RETURNING conteudo_adulto`,
            [conteudo_adulto, userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Usuário não encontrado no banco de dados." });
        }

        // Caminho Feliz: Retorna 200 OK
        return res.status(200).json({ 
            message: "Preferência de exibição atualizada com sucesso!",
            conteudo_adulto: result.rows[0].conteudo_adulto
        });

    } catch (error) {
        console.error("Erro ao atualizar preferência +18:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};

exports.updateUserById = async (req, res) => {
    try {
        const targetId = req.params.id; // O ID que o usuário quer alterar
        const requesterId = req.user.userId; // O ID real do token
        const requesterRole = req.user.role; // Nível de acesso do token

        // RN0022: Se for Usuário Padrão e tentar alterar o ID de outro, toma bloqueio 403.
        if (requesterRole === 'Usuário Padrão' && targetId !== requesterId) {
            return res.status(403).json({ 
                error: "Acesso negado: Você não tem permissão para acessar ou modificar os dados deste perfil." 
            });
        }

        // Se a requisição passou do bloqueio, aqui entraria o código de UPDATE geral...
        return res.status(200).json({ message: "Permissão concedida. Rota de atualização genérica em construção." });

    } catch (error) {
        console.error("Erro na trava IDOR de atualização:", error);
        return res.status(500).json({ error: "Erro interno." });
    }
};


exports.logoutUser = async (req, res) => {
    try {
        await db.query(
            `UPDATE sessions
             SET revoked_at = CURRENT_TIMESTAMP
             WHERE id = $1
               AND revoked_at IS NULL`,
            [req.session.id]
        );

        clearSessionCookie(req, res);

        return res.status(200).json({ message: "Sessão encerrada com sucesso." });

    } catch (error) {
        console.error("Erro no logout:", error);
        return res.status(500).json({ error: "Erro interno ao tentar encerrar a sessão." });
    }
};
