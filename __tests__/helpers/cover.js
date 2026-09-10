const crypto = require('node:crypto');
const db = require('../../src/database');
async function createTestCover(client = db, prefix = 'fixture-cover') {
    const result = await client.query(`INSERT INTO media_assets
        (provider, object_key, mime_type, format, width, height, bytes, checksum)
        VALUES ('r2', $1, 'image/webp', 'webp', 10, 15, 10, repeat('a', 64)) RETURNING id`,
        [`${prefix}/${crypto.randomUUID()}.webp`]);
    return result.rows[0].id;
}
module.exports = { createTestCover };
