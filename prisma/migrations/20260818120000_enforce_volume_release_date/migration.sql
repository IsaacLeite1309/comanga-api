ALTER TABLE volumes
    ALTER COLUMN release_date_precision SET DEFAULT 'Completa';

ALTER TABLE volumes
    DROP CONSTRAINT IF EXISTS volumes_release_precision_check;

-- NOT VALID preserva volumes legados sem data conhecida. A restrição já é
-- aplicada a toda nova linha ou linha alterada, sem inventar dados históricos.
ALTER TABLE volumes
    ADD CONSTRAINT volumes_release_precision_check
    CHECK (
        release_date_precision IN ('Completa', 'Mes e ano', 'Ano')
        AND (
        (release_date_precision = 'Completa'
            AND release_year IS NOT NULL
            AND release_month IS NOT NULL
            AND release_day IS NOT NULL)
        OR (release_date_precision = 'Mes e ano'
            AND release_year IS NOT NULL
            AND release_month IS NOT NULL
            AND release_day IS NULL)
        OR (release_date_precision = 'Ano'
            AND release_year IS NOT NULL
            AND release_month IS NULL
            AND release_day IS NULL)
        )
    ) NOT VALID;
