import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors, { type CorsOptions } from 'cors';
import prisma from './prisma';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import adminRoutes from './routes/adminRoutes';
import errorHandler from './middlewares/errorHandler';
import requestContext from './middlewares/requestContext';
import requestLogger from './middlewares/requestLogger';
import notFoundHandler from './middlewares/notFoundHandler';
import ApplicationError from './errors/ApplicationError';
import healthRouter from './infrastructure/operations/healthRouter';

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

        return callback(new ApplicationError({
            statusCode: 403,
            code: 'CORS_ORIGIN_DENIED',
            message: 'Origem não permitida pelo CORS.'
        }));
    },
    credentials: true
};

app.use(requestContext);
if (process.env.NODE_ENV !== 'test' || process.env.REQUEST_LOGGING_ENABLED === 'true') {
    app.use(requestLogger);
}
app.use(cors(corsOptions));
app.use(express.json());

app.use('/health', healthRouter);

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
        throw new ApplicationError({
            statusCode: 500,
            code: 'DATABASE_UNAVAILABLE',
            message: 'Banco de dados indisponível.',
            cause: error
        });
    }
});

app.use(notFoundHandler);
app.use(errorHandler);

export = app;
