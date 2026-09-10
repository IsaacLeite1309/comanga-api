-- Validate legacy associations without changing or deleting catalog data.
DO $$ BEGIN
  IF EXISTS (
    SELECT cover_asset_id FROM (
      SELECT cover_asset_id FROM works UNION ALL
      SELECT cover_asset_id FROM editions UNION ALL
      SELECT cover_asset_id FROM volumes
    ) links GROUP BY cover_asset_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Uma capa está vinculada a mais de um registro. Associe capas distintas antes do deploy.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM media_assets m WHERE m.status NOT IN ('Pendente', 'Ativo') AND (
      EXISTS (SELECT 1 FROM works WHERE cover_asset_id=m.id) OR
      EXISTS (SELECT 1 FROM editions WHERE cover_asset_id=m.id) OR
      EXISTS (SELECT 1 FROM volumes WHERE cover_asset_id=m.id))
  ) THEN
    RAISE EXCEPTION 'Existe registro associado a capa em descarte. Corrija a associação antes do deploy.';
  END IF;
END $$;
