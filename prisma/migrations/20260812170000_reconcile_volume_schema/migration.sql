DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'volumes'
          AND column_name = 'release_date'
    ) THEN
        UPDATE volumes
        SET
            release_year = COALESCE(release_year, EXTRACT(YEAR FROM release_date)::INTEGER),
            release_month = COALESCE(release_month, EXTRACT(MONTH FROM release_date)::INTEGER),
            release_day = COALESCE(release_day, EXTRACT(DAY FROM release_date)::INTEGER),
            release_date_precision = CASE
                WHEN release_date IS NOT NULL
                 AND release_date_precision = 'Desconhecida'
                    THEN 'Completa'
                ELSE release_date_precision
            END
        WHERE release_date IS NOT NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'volumes'
          AND column_name = 'isbn'
    ) THEN
        UPDATE volumes
        SET isbn_13 = COALESCE(isbn_13, isbn)
        WHERE isbn IS NOT NULL;
    END IF;
END $$;

ALTER TABLE volumes
    ALTER COLUMN release_date_precision SET DEFAULT 'Desconhecida',
    DROP COLUMN IF EXISTS release_date,
    DROP COLUMN IF EXISTS isbn;
