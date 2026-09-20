-- A Edição deixa de ter capa própria: a capa exibida passa a ser derivada do
-- Volume de número 1 da MESMA Edição. Esta migration não apaga media_assets nem
-- objetos do R2; apenas coloca no ciclo controlado de descarte ('Descartando')
-- os ativos que ficarem órfãos, para o comando de manutenção já existente
-- (cleanupDiscardedCovers) removê-los depois.
--
-- Rollback operacional: esta migration é destrutiva para editions.cover_asset_id.
-- Para voltar atrás é preciso restaurar o backup lógico do banco anterior à
-- aplicação (pg_dump antes do deploy) OU, se os ativos ainda existirem, recriar
-- a coluna/índice/FK e reassociar manualmente:
--   ALTER TABLE editions ADD COLUMN cover_asset_id UUID;
--   CREATE UNIQUE INDEX editions_cover_asset_id_key ON editions(cover_asset_id);
--   ALTER TABLE editions ADD CONSTRAINT editions_cover_asset_id_fkey
--     FOREIGN KEY (cover_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
-- e recriar os gatilhos de capa para editions (ver 20260909231000). Os ativos
-- marcados como 'Descartando' por esta migration só podem ser reaproveitados
-- antes de `npm run media:cleanup`; depois disso a imagem já não está no R2.

-- 1) Inventário: nenhuma Edição pública pode ficar sem origem válida de capa.
DO $$
DECLARE
    editions_without_source TEXT;
BEGIN
    SELECT string_agg(edition.id::TEXT, ', ' ORDER BY edition.id)
      INTO editions_without_source
      FROM editions AS edition
     WHERE edition.visibility = 'Público'
       AND NOT EXISTS (
            SELECT 1
              FROM volumes AS volume
             WHERE volume.edition_id = edition.id
               AND volume.number = 1
               AND volume.cover_asset_id IS NOT NULL
       );

    IF editions_without_source IS NOT NULL THEN
        RAISE EXCEPTION 'Edições públicas sem Volume 1 com capa interna: %. Cadastre o Volume 1 com capa válida ou torne essas Edições privadas antes de aplicar esta migration.', editions_without_source;
    END IF;
END $$;

-- 2) Guarda os ativos das antigas capas próprias de Edição antes de perder a coluna.
DROP TABLE IF EXISTS legacy_edition_cover_assets;
CREATE TEMPORARY TABLE legacy_edition_cover_assets AS
SELECT DISTINCT cover_asset_id AS id
  FROM editions
 WHERE cover_asset_id IS NOT NULL;

-- 3) Gatilhos e funções de ciclo de vida deixam de enxergar editions.
DROP TRIGGER IF EXISTS validate_cover_attachment ON editions;
DROP TRIGGER IF EXISTS discard_detached_cover ON editions;
DROP TRIGGER IF EXISTS cover_lifecycle_lock ON editions;

CREATE OR REPLACE FUNCTION validate_cover_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cover_asset_id IS NOT DISTINCT FROM OLD.cover_asset_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM media_assets WHERE id = NEW.cover_asset_id AND status IN ('Pendente', 'Ativo'))
     OR EXISTS (SELECT 1 FROM works WHERE cover_asset_id = NEW.cover_asset_id)
     OR EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id = NEW.cover_asset_id) THEN
    RAISE EXCEPTION 'Capa inválida, em descarte ou já associada.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION discard_detached_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cover_asset_id IS NOT DISTINCT FROM OLD.cover_asset_id THEN RETURN NULL; END IF;
  UPDATE media_assets SET status = 'Descartando' WHERE id = OLD.cover_asset_id
    AND NOT EXISTS (SELECT 1 FROM works WHERE cover_asset_id = OLD.cover_asset_id)
    AND NOT EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id = OLD.cover_asset_id);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION protect_discarded_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'Descartando' AND NEW.status <> 'Descartando' THEN
    RAISE EXCEPTION 'Capa em descarte não pode ser reativada.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'Descartando' AND (
    EXISTS (SELECT 1 FROM works WHERE cover_asset_id = NEW.id) OR
    EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id = NEW.id)) THEN
    RAISE EXCEPTION 'Capa associada não pode ser descartada.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 4) Remove FK, índice único e a coluna da capa própria da Edição.
ALTER TABLE editions DROP CONSTRAINT IF EXISTS editions_cover_asset_id_fkey;
DROP INDEX IF EXISTS editions_cover_asset_id_key;
ALTER TABLE editions DROP COLUMN IF EXISTS cover_asset_id;

-- 5) Descarte controlado: só entram os ativos que ficaram sem nenhuma referência.
UPDATE media_assets
   SET status = 'Descartando'
 WHERE id IN (SELECT id FROM legacy_edition_cover_assets)
   AND status <> 'Descartando'
   AND NOT EXISTS (SELECT 1 FROM works WHERE cover_asset_id = media_assets.id)
   AND NOT EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id = media_assets.id);
