// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Nossa Rota de Teste (Ping)
app.get('/ping', (req, res) => {
    res.json({ 
        status: "Online", 
        message: "API do CoMangá operando perfeitamente!",
        timestamp: new Date()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});