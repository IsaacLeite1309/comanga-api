const db = require('./src/database');
const prisma = require('./src/prisma');

afterAll(async () => {
    await prisma.$disconnect();
    await db.pool.end();
});
