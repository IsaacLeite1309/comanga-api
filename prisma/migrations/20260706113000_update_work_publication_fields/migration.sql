ALTER TABLE works
    DROP COLUMN IF EXISTS release_year,
    ADD COLUMN IF NOT EXISTS original_publication_start_year INTEGER,
    ADD COLUMN IF NOT EXISTS original_publication_end_year INTEGER,
    ADD COLUMN IF NOT EXISTS original_volume_count INTEGER,
    ADD COLUMN IF NOT EXISTS direct_release BOOLEAN NOT NULL DEFAULT FALSE;
