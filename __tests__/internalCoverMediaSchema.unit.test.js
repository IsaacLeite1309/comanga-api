const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const migrationPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260819180000_internal_cover_media',
    'migration.sql'
);

describe('modelagem de capas internas', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    it('modela o ativo e suas variantes sem acoplar o catálogo a uma URL pública', () => {
        expect(schema).toMatch(/model MediaAsset\s*{/);
        expect(schema).toMatch(/model MediaVariant\s*{/);
        expect(schema).toMatch(/objectKey\s+String\s+@unique\s+@map\("object_key"\)/);
        expect(schema).toMatch(/sourceUrl\s+String\?\s+@map\("source_url"\)/);
        expect(schema).toMatch(/createdByUserId\s+String\?/);
        expect(schema).toMatch(/createdBy\s+User\?.*onDelete: SetNull/);
        expect(schema).toMatch(/@@unique\(\[mediaAssetId, kind\]/);
    });

    it.each(['Work', 'Edition', 'Volume'])('%s referencia uma capa interna opcional', (modelName) => {
        const model = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';

        expect(model).toMatch(/coverAssetId\s+String\?\s+@unique\s+@map\("cover_asset_id"\)\s+@db\.Uuid/);
        expect(model).toMatch(/coverAsset\s+MediaAsset\?/);
        expect(model).not.toMatch(/coverUrl\s+String/);
    });

    it('versiona a criação das tabelas, relacionamentos e remoção das URLs externas', () => {
        const migration = fs.readFileSync(migrationPath, 'utf8');

        expect(migration).toContain('CREATE TABLE "media_assets"');
        expect(migration).toContain('CREATE TABLE "media_variants"');
        expect(migration).toContain('ADD COLUMN "cover_asset_id" UUID');
        expect(migration).toContain('DROP COLUMN "cover_url"');
        expect(migration).toContain('media_assets_object_key_key');
        expect(migration).toContain('media_variants_media_asset_id_kind_key');
        expect(migration).toContain('ON DELETE SET NULL');
    });
});
