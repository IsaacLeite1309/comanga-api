// src/database/index.js
const { Pool } = require('pg');

// Cria o pool de conexões usando a sua DATABASE_URL do .env
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // O SSL é obrigatório para bancos em nuvem como o Neon e Render
    ssl: {
        rejectUnauthorized: false 
    }
});

// Mensagem de log para confirmar a conexão quando o servidor ligar
pool.on('connect', () => {
    console.log('📦 Banco de Dados conectado com sucesso!');
});

// Exporta uma função facilitadora para rodarmos nossas queries depois
module.exports = {
    query: (text, params) => pool.query(text, params),
};