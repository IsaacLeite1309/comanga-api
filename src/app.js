require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./prisma');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8080')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Origem nao permitida pelo CORS.'));
    },
    credentials: true
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

app.get('/ping', async (req, res) => {
    try {
        const result = await prisma.$queryRaw`SELECT NOW() AS hora_atual`;

        res.json({
            status: "Online",
            message: "API e Banco de Dados operando perfeitamente!",
            database_time: result[0].hora_atual
        });
    } catch (error) {
        console.error('Erro na conexao com o banco:', error);
        res.status(500).json({
            status: "Erro Critico",
            message: "API online, mas o Banco de Dados falhou.",
            error: error.message
        });
    }
});

module.exports = app;
