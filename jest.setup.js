const db = require('./src/database');

afterAll(async () => {
    await db.pool.end();
});
