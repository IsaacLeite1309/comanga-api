require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
    for (const table of ['works', 'editions', 'volumes']) {
        const rows = await prisma.$queryRawUnsafe(`SELECT id FROM ${table} WHERE cover_asset_id IS NULL ORDER BY id`);
        console.log(`${table}: ${rows.length} sem capa; IDs: ${rows.map(row => row.id).join(', ')}`);
        if (rows.length) process.exitCode = 1;
    }
    const duplicate = await prisma.$queryRaw`SELECT cover_asset_id FROM (
        SELECT cover_asset_id FROM works UNION ALL SELECT cover_asset_id FROM editions UNION ALL SELECT cover_asset_id FROM volumes
    ) links WHERE cover_asset_id IS NOT NULL GROUP BY cover_asset_id HAVING COUNT(*) > 1`;
    console.log(`Capas compartilhadas indevidamente: ${duplicate.length}; IDs: ${duplicate.map(row => row.cover_asset_id).join(', ')}`);
    if (duplicate.length) process.exitCode = 1;
})().catch(() => { console.error('Falha ao verificar capas.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
