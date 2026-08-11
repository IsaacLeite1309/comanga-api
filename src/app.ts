import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors, { type CorsOptions } from 'cors';
import prisma from './prisma';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import adminRoutes from './routes/adminRoutes';
import errorHandler from './middlewares/errorHandler';

type PingResult = Array<{ hora_atual: Date }>;

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8080')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions: CorsOptions = {
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Origem nao permitida pelo CORS.'));
    },
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

app.get('/ping', async (_req: Request, res: Response) => {
    try {
        const result = await prisma.$queryRaw<PingResult>`SELECT NOW() AS hora_atual`;

        res.json({
            status: 'Online',
            message: 'API e Banco de Dados operando perfeitamente!',
            database_time: result[0].hora_atual
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido.';
        console.error('Erro na conexao com o banco:', error);
        res.status(500).json({
            status: 'Erro Critico',
            message: 'API online, mas o Banco de Dados falhou.',
            error: message
        });
    }
});

app.use(errorHandler);

export = app;
