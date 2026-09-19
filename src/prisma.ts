import { PrismaClient } from '@prisma/client';
import { configurePrismaConnectionUrl } from './infrastructure/database/prismaConnectionUrl';

if (process.env.DATABASE_URL) {
    process.env.DATABASE_URL = configurePrismaConnectionUrl(process.env.DATABASE_URL);
}

const prisma = new PrismaClient();

export = prisma;
