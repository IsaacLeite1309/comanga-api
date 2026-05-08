// src/routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');
const userController = require('../controllers/userController'); // Importando o nosso novo controlador poderoso

const router = express.Router();

// 🟢 NOVA ROTA DE CADASTRO (Delegada para o Controller que atende todas as Regras de Negócio)
router.post('/register', userController.registerUser);

// 🔵 ROTA DE LOGIN (Mantida na V0 até chegarmos no respectivo cartão do Kanban)
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Busca o usuário no banco
        const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas!' });
        }

        const user = result.rows[0];

        // 2. Verifica se a senha bate com o hash salvo
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciais inválidas!' });
        }

        // 3. Gera o Token JWT (O "Crachá" do usuário)
        const token = jwt.sign(
            { id: user.id, role: user.nivel_acesso }, // Atualizado para a nova coluna nivel_acesso
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ message: 'Login bem-sucedido!', token, user: { id: user.id, username: user.username, role: user.nivel_acesso } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro interno no servidor' });
    }
});

module.exports = router;