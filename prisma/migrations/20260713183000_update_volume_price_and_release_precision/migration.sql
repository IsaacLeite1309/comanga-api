ALTER TABLE volumes
    ADD COLUMN IF NOT EXISTS price_currency VARCHAR(10) NOT NULL DEFAULT 'R$',
    ADD COLUMN IF NOT EXISTS release_date_precision VARCHAR(20) NOT NULL DEFAULT 'Desconhecida',
    ADD COLUMN IF NOT EXISTS release_year INTEGER,
    ADD COLUMN IF NOT EXISTS release_month INTEGER,
    ADD COLUMN IF NOT EXISTS release_day INTEGER;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'volumes'
          AND column_name = 'release_date'
    ) THEN
        UPDATE volumes
        SET
            release_date_precision = 'Completa',
            release_year = EXTRACT(YEAR FROM release_date)::INTEGER,
            release_month = EXTRACT(MONTH FROM release_date)::INTEGER,
            release_day = EXTRACT(DAY FROM release_date)::INTEGER
        WHERE release_date IS NOT NULL
          AND release_date_precision = 'Desconhecida';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'volumes_price_currency_check'
    ) THEN
        ALTER TABLE volumes
            ADD CONSTRAINT volumes_price_currency_check
            CHECK (price_currency IN ('R$', 'CR$', 'Cr$', 'NCz$', 'Cz$'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'volumes_release_precision_check'
    ) THEN
        ALTER TABLE volumes
            ADD CONSTRAINT volumes_release_precision_check
            CHECK (release_date_precision IN ('Completa', 'Mes e ano', 'Ano', 'Desconhecida'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'volumes_release_month_check'
    ) THEN
        ALTER TABLE volumes
            ADD CONSTRAINT volumes_release_month_check
            CHECK (release_month IS NULL OR (release_month >= 1 AND release_month <= 12));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'volumes_release_day_check'
    ) THEN
        ALTER TABLE volumes
            ADD CONSTRAINT volumes_release_day_check
            CHECK (release_day IS NULL OR (release_day >= 1 AND release_day <= 31));
    END IF;
END $$;
