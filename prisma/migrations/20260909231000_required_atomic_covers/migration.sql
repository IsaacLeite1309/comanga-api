-- Do not manufacture covers or delete legacy catalog entries.
-- Run scripts/check-catalog-covers.js and supply real covers before deploying this migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM works WHERE cover_asset_id IS NULL)
     OR EXISTS (SELECT 1 FROM editions WHERE cover_asset_id IS NULL)
     OR EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id IS NULL) THEN
    RAISE EXCEPTION 'Existem registros sem capa. Associe capas internas válidas antes de aplicar esta migration.';
  END IF;
END $$;
ALTER TABLE works ALTER COLUMN cover_asset_id SET NOT NULL;
ALTER TABLE editions ALTER COLUMN cover_asset_id SET NOT NULL;
ALTER TABLE volumes ALTER COLUMN cover_asset_id SET NOT NULL;
ALTER TABLE works DROP CONSTRAINT works_cover_asset_id_fkey, ADD CONSTRAINT works_cover_asset_id_fkey FOREIGN KEY (cover_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
ALTER TABLE editions DROP CONSTRAINT editions_cover_asset_id_fkey, ADD CONSTRAINT editions_cover_asset_id_fkey FOREIGN KEY (cover_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
ALTER TABLE volumes DROP CONSTRAINT volumes_cover_asset_id_fkey, ADD CONSTRAINT volumes_cover_asset_id_fkey FOREIGN KEY (cover_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
ALTER TABLE media_assets DROP CONSTRAINT media_assets_status_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_status_check CHECK (status IN ('Pendente', 'Ativo', 'Descartando'));

-- Acquire before row locks, consistently across all writers (including direct SQL).
CREATE FUNCTION lock_cover_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(9142026);
  RETURN NULL;
END $$;
CREATE TRIGGER cover_lifecycle_lock BEFORE INSERT OR UPDATE OR DELETE ON works FOR EACH STATEMENT EXECUTE FUNCTION lock_cover_lifecycle();
CREATE TRIGGER cover_lifecycle_lock BEFORE INSERT OR UPDATE OR DELETE ON editions FOR EACH STATEMENT EXECUTE FUNCTION lock_cover_lifecycle();
CREATE TRIGGER cover_lifecycle_lock BEFORE INSERT OR UPDATE OR DELETE ON volumes FOR EACH STATEMENT EXECUTE FUNCTION lock_cover_lifecycle();
CREATE TRIGGER cover_lifecycle_lock BEFORE INSERT OR UPDATE OR DELETE ON media_assets FOR EACH STATEMENT EXECUTE FUNCTION lock_cover_lifecycle();

CREATE FUNCTION validate_cover_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cover_asset_id IS NOT DISTINCT FROM OLD.cover_asset_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM media_assets WHERE id = NEW.cover_asset_id AND status IN ('Pendente', 'Ativo'))
     OR EXISTS (SELECT 1 FROM works WHERE cover_asset_id = NEW.cover_asset_id)
     OR EXISTS (SELECT 1 FROM editions WHERE cover_asset_id = NEW.cover_asset_id)
     OR EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id = NEW.cover_asset_id) THEN
    RAISE EXCEPTION 'Capa inválida, em descarte ou já associada.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_cover_attachment BEFORE INSERT OR UPDATE OF cover_asset_id ON works FOR EACH ROW EXECUTE FUNCTION validate_cover_attachment();
CREATE TRIGGER validate_cover_attachment BEFORE INSERT OR UPDATE OF cover_asset_id ON editions FOR EACH ROW EXECUTE FUNCTION validate_cover_attachment();
CREATE TRIGGER validate_cover_attachment BEFORE INSERT OR UPDATE OF cover_asset_id ON volumes FOR EACH ROW EXECUTE FUNCTION validate_cover_attachment();

CREATE FUNCTION discard_detached_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cover_asset_id IS NOT DISTINCT FROM OLD.cover_asset_id THEN RETURN NULL; END IF;
  UPDATE media_assets SET status = 'Descartando' WHERE id = OLD.cover_asset_id
    AND NOT EXISTS (SELECT 1 FROM works WHERE cover_asset_id = OLD.cover_asset_id)
    AND NOT EXISTS (SELECT 1 FROM editions WHERE cover_asset_id = OLD.cover_asset_id)
    AND NOT EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id = OLD.cover_asset_id);
  RETURN NULL;
END $$;
CREATE TRIGGER discard_detached_cover AFTER UPDATE OF cover_asset_id OR DELETE ON works FOR EACH ROW EXECUTE FUNCTION discard_detached_cover();
CREATE TRIGGER discard_detached_cover AFTER UPDATE OF cover_asset_id OR DELETE ON editions FOR EACH ROW EXECUTE FUNCTION discard_detached_cover();
CREATE TRIGGER discard_detached_cover AFTER UPDATE OF cover_asset_id OR DELETE ON volumes FOR EACH ROW EXECUTE FUNCTION discard_detached_cover();

CREATE FUNCTION protect_discarded_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'Descartando' AND NEW.status <> 'Descartando' THEN
    RAISE EXCEPTION 'Capa em descarte não pode ser reativada.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'Descartando' AND (
    EXISTS (SELECT 1 FROM works WHERE cover_asset_id = NEW.id) OR
    EXISTS (SELECT 1 FROM editions WHERE cover_asset_id = NEW.id) OR
    EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id = NEW.id)) THEN
    RAISE EXCEPTION 'Capa associada não pode ser descartada.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_discarded_cover BEFORE UPDATE OF status ON media_assets FOR EACH ROW EXECUTE FUNCTION protect_discarded_cover();
