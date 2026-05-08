// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');
const authRoutes = require('./routes/authRoutes'); // NOVO: Importando as rotas

const app = express();
app.use(cors());
app.use(express.json());

// Registro da rota raiz de usuários
app.use('/api/auth', authRoutes); 

// Rota de Health Check (Teste Real de Banco de Dados)
app.get('/ping', async (req, res) => {
    try {
        // Vai até o Neon e executa um SELECT simples
        const result = await db.query('SELECT NOW() AS hora_atual');
        
        res.json({ 
            status: "Online", 
            message: "API e Banco de Dados operando perfeitamente!",
            database_time: result.rows[0].hora_atual
        });
    } catch (error) {
        console.error('Erro na conexão com o banco:', error);
        res.status(500).json({ 
            status: "Erro Crítico", 
            message: "API online, mas o Banco de Dados falhou.",
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});