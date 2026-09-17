CREATE INDEX IF NOT EXISTS idx_works_visibility_original_status
    ON works (visibility, original_publication_status, id);

CREATE INDEX IF NOT EXISTS idx_editions_visibility_chronological
    ON editions (visibility, chronological_number, id);

CREATE INDEX IF NOT EXISTS idx_editions_visibility_publication_status
    ON editions (visibility, brazil_publication_status, id);
