-- As URLs externas existentes pertencem apenas aos cadastros de teste. A nova
-- modelagem não as migra: registros sem ativo interno passam a usar o fallback.
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(40) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "source_url" VARCHAR(2048),
    "mime_type" VARCHAR(100) NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Pendente',
    "created_by_user_id" UUID,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativado_em" TIMESTAMPTZ,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_dimensions_check" CHECK ("width" > 0 AND "height" > 0),
    CONSTRAINT "media_assets_bytes_check" CHECK ("bytes" > 0),
    CONSTRAINT "media_assets_status_check" CHECK ("status" IN ('Pendente', 'Ativo'))
);

CREATE TABLE "media_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "media_asset_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_variants_dimensions_check" CHECK ("width" > 0 AND "height" > 0),
    CONSTRAINT "media_variants_bytes_check" CHECK ("bytes" > 0)
);

ALTER TABLE "works" ADD COLUMN "cover_asset_id" UUID;
ALTER TABLE "editions" ADD COLUMN "cover_asset_id" UUID;
ALTER TABLE "volumes" ADD COLUMN "cover_asset_id" UUID;

ALTER TABLE "works" DROP COLUMN "cover_url";
ALTER TABLE "editions" DROP COLUMN "cover_url";
ALTER TABLE "volumes" DROP COLUMN "cover_url";

CREATE UNIQUE INDEX "media_assets_object_key_key" ON "media_assets"("object_key");
CREATE INDEX "idx_media_assets_status_created" ON "media_assets"("status", "criado_em");
CREATE INDEX "idx_media_assets_created_by" ON "media_assets"("created_by_user_id");
CREATE UNIQUE INDEX "media_variants_object_key_key" ON "media_variants"("object_key");
CREATE UNIQUE INDEX "media_variants_media_asset_id_kind_key" ON "media_variants"("media_asset_id", "kind");
CREATE INDEX "idx_media_variants_asset" ON "media_variants"("media_asset_id");
CREATE UNIQUE INDEX "works_cover_asset_id_key" ON "works"("cover_asset_id");
CREATE UNIQUE INDEX "editions_cover_asset_id_key" ON "editions"("cover_asset_id");
CREATE UNIQUE INDEX "volumes_cover_asset_id_key" ON "volumes"("cover_asset_id");

ALTER TABLE "media_assets"
    ADD CONSTRAINT "media_assets_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "media_variants"
    ADD CONSTRAINT "media_variants_media_asset_id_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "works"
    ADD CONSTRAINT "works_cover_asset_id_fkey"
    FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "editions"
    ADD CONSTRAINT "editions_cover_asset_id_fkey"
    FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "volumes"
    ADD CONSTRAINT "volumes_cover_asset_id_fkey"
    FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
