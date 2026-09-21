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

    function modelOf(modelName) {
        return schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
    }

    it.each(['Work', 'Volume'])('%s referencia uma capa interna obrigatória', (modelName) => {
        const model = modelOf(modelName);

        expect(model).toMatch(/coverAssetId\s+String\s+@unique\s+@map\("cover_asset_id"\)\s+@db\.Uuid/);
        expect(model).toMatch(/coverAsset\s+MediaAsset/);
        expect(model).not.toMatch(/coverUrl\s+String/);
    });

    it('Edition não possui capa própria: a capa é derivada do Volume 1 da mesma Edição', () => {
        const model = modelOf('Edition');

        expect(model).not.toMatch(/coverAssetId/);
        expect(model).not.toMatch(/coverAsset\s+MediaAsset/);
        expect(model).toMatch(/volumes\s+Volume\[\]/);
        expect(modelOf('MediaAsset')).not.toMatch(/EditionCover/);
    });

    it('versiona a remoção da capa própria da Edição sem apagar ativos ainda usados', () => {
        const migration = fs.readFileSync(path.join(
            __dirname, '..', 'prisma', 'migrations',
            '20260920122000_derive_edition_cover_from_first_volume', 'migration.sql'
        ), 'utf8');

        expect(migration).toContain('ALTER TABLE editions DROP COLUMN IF EXISTS cover_asset_id');
        expect(migration).toContain('DROP INDEX IF EXISTS editions_cover_asset_id_key');
        expect(migration).toContain('editions_cover_asset_id_fkey');
        expect(migration).toMatch(/RAISE EXCEPTION 'Edições públicas sem Volume 1 com capa interna/);
        // Órfãos entram no ciclo controlado de descarte; nada é apagado aqui.
        expect(migration).toMatch(/UPDATE media_assets\s*\n\s*SET status = 'Descartando'/);
        expect(migration).toMatch(/NOT EXISTS \(SELECT 1 FROM works WHERE cover_asset_id = media_assets\.id\)/);
        expect(migration).toMatch(/NOT EXISTS \(SELECT 1 FROM volumes WHERE cover_asset_id = media_assets\.id\)/);
        expect(migration).not.toMatch(/DELETE FROM media_assets/);
        expect(migration).not.toMatch(/DROP TABLE media_assets/);
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
