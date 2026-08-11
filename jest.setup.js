const db = require('./src/database');
const prisma = require('./src/prisma');

jest.setTimeout(30000);

afterAll(async () => {
    await prisma.$disconnect();
    await db.pool.end();
});
