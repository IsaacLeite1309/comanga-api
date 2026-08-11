ALTER TABLE volumes
    ADD COLUMN IF NOT EXISTS isbn_10 VARCHAR(20),
    ADD COLUMN IF NOT EXISTS isbn_13 VARCHAR(20);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'volumes'
          AND column_name = 'isbn'
    ) THEN
        UPDATE volumes
        SET isbn_13 = isbn
        WHERE isbn IS NOT NULL
          AND isbn_13 IS NULL;
    END IF;
END $$;
