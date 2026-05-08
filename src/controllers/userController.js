// src/controllers/userController.js
const db = require('../database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { z } = require('zod');
const mailer = require('../utils/mailer');

// SCHEMA DE VALIDAÇÃO (ZOD)
const registerSchema = z.object({
    username: z.string()
        .regex(/^[a-zA-Z0-9_]{3,20}$/, "Utilize entre 3 e 20 caracteres, sem espaços, acentos ou caracteres especiais."), // RN0001
    email: z.string().email("E-mail com formato inválido."),
    password: z.string()
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/, "Utilize no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial."), // RN0002
    confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
    message: "Divergência nos valores da senha e confirmação de senha!", // RN0020
    path: ["confirmPassword"]
});

exports.registerUser = async (req, res) => {
    try {
        // 1. Validação de Formato e Regras (RN0001, RN0002, RN0020)
        const validation = registerSchema.safeParse(req.body);

        if (!validation.success) {
            // Usamos .issues que é o padrão do Zod e pegamos a primeira mensagem de erro
            const message = validation.error.issues[0]?.message || "Dados de cadastro inválidos.";
    
            console.warn("⚠️ Falha de validação Zod:", message);
    
            return res.status(400).json({ 
                error: message 
            });
        }

        const { username, email, password } = validation.data;

        // 2. Validação de Unicidade no Banco (RN0003 e RN0004)
        const checkQuery = await db.query(
            'SELECT username, email FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );

        if (checkQuery.rows.length > 0) {
            const conflict = checkQuery.rows[0];
            if (conflict.email === email) {
                return res.status(409).json({ error: "Este endereço de e-mail já está em uso. Tente fazer login ou recuperar sua senha." });
            }
            if (conflict.username === username) {
                return res.status(409).json({ error: "Este nome de usuário não está disponível. Por favor, escolha outro." });
            }
        }

        // 3. Criptografia e Geração de Token
        const passwordHash = await bcrypt.hash(password, 10);
        const activationToken = crypto.randomBytes(32).toString('hex'); // Token seguro de 64 caracteres

        // 4. Inserção no Banco de Dados
        await db.query(
            `INSERT INTO users (username, email, password_hash, activation_token) 
             VALUES ($1, $2, $3, $4)`,
            [username, email, passwordHash, activationToken]
        );

        // 5. Disparo do E-mail
        try {
            await mailer.sendActivationEmail(email, username, activationToken);
        } catch (mailError) {
            console.error("Falha ao enviar e-mail:", mailError);
            // Mesmo se o e-mail falhar, o usuário foi criado. Retornamos um aviso.
            return res.status(201).json({ 
                message: "Conta criada, mas houve um erro ao enviar o e-mail de ativação. Você poderá solicitar o reenvio na tela de cadastro." 
            });
        }

        // Caminho Feliz Perfeito
        return res.status(201).json({ 
            message: "Conta criada com sucesso! Verifique seu e-mail para ativar." 
        });

    } catch (error) {
        console.error("Erro no registro:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
};