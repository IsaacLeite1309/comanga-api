CREATE INDEX IF NOT EXISTS idx_volumes_edition_visibility_number_year
    ON volumes (edition_id, visibility, number, release_year);
