ALTER TABLE volumes
    ADD COLUMN IF NOT EXISTS single_volume BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE volumes
    DROP CONSTRAINT IF EXISTS volumes_number_check;

ALTER TABLE volumes
    ADD CONSTRAINT volumes_number_check
    CHECK (number >= 0);
