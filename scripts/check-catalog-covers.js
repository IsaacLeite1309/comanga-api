require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
    for (const table of ['works', 'volumes']) {
        const rows = await prisma.$queryRawUnsafe(`SELECT id FROM ${table} WHERE cover_asset_id IS NULL ORDER BY id`);
        console.log(`${table}: ${rows.length} sem capa; IDs: ${rows.map(row => row.id).join(', ')}`);
        if (rows.length) process.exitCode = 1;
    }
    // A Edição não tem capa própria: a capa é derivada do Volume 1 da mesma Edição.
    const withoutSource = await prisma.$queryRaw`SELECT edition.id, edition.visibility FROM editions AS edition
        WHERE NOT EXISTS (
            SELECT 1 FROM volumes AS volume
            WHERE volume.edition_id = edition.id AND volume.number = 1 AND volume.cover_asset_id IS NOT NULL
        ) ORDER BY edition.id`;
    const publicWithoutSource = withoutSource.filter(row => row.visibility === 'Público');
    console.log(`editions: ${withoutSource.length} sem capa derivável (sem Volume 1 com capa); IDs: ${withoutSource.map(row => row.id).join(', ')}`);
    console.log(`editions públicas sem capa derivável: ${publicWithoutSource.length}; IDs: ${publicWithoutSource.map(row => row.id).join(', ')}`);
    if (publicWithoutSource.length) process.exitCode = 1;
    const privateSource = await prisma.$queryRaw`SELECT volume.edition_id AS id FROM volumes AS volume
        JOIN editions AS edition ON edition.id = volume.edition_id
        WHERE volume.number = 1 AND edition.visibility = 'Público' AND volume.visibility <> 'Público' ORDER BY volume.edition_id`;
    console.log(`editions públicas com Volume 1 privado: ${privateSource.length}; IDs: ${privateSource.map(row => row.id).join(', ')}`);
    if (privateSource.length) process.exitCode = 1;
    const duplicate = await prisma.$queryRaw`SELECT cover_asset_id FROM (
        SELECT cover_asset_id FROM works UNION ALL SELECT cover_asset_id FROM volumes
    ) links WHERE cover_asset_id IS NOT NULL GROUP BY cover_asset_id HAVING COUNT(*) > 1`;
    console.log(`Capas compartilhadas indevidamente: ${duplicate.length}; IDs: ${duplicate.map(row => row.cover_asset_id).join(', ')}`);
    if (duplicate.length) process.exitCode = 1;
})().catch(() => { console.error('Falha ao verificar capas.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
