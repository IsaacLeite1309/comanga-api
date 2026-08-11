CREATE TABLE volumes (
    id SERIAL PRIMARY KEY,
    edition_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    cover_url VARCHAR(2048),
    single_volume BOOLEAN NOT NULL DEFAULT FALSE,
    pages INTEGER,
    price NUMERIC(10, 2),
    price_currency VARCHAR(10) NOT NULL DEFAULT 'R$',
    release_date_precision VARCHAR(20) NOT NULL DEFAULT 'Completa',
    release_year INTEGER,
    release_month INTEGER,
    release_day INTEGER,
    isbn_10 VARCHAR(20),
    isbn_13 VARCHAR(20),
    affiliate_link VARCHAR(2048),
    synopsis TEXT,
    visibility VARCHAR(20) NOT NULL DEFAULT 'Privado',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT volumes_edition_id_fkey
        FOREIGN KEY (edition_id)
        REFERENCES editions(id)
        ON DELETE RESTRICT,
    CONSTRAINT volumes_visibility_check
        CHECK (visibility IN ('Privado', 'PÃºblico')),
    CONSTRAINT volumes_number_check
        CHECK (number >= 0),
    CONSTRAINT volumes_pages_check
        CHECK (pages IS NULL OR pages > 0),
    CONSTRAINT volumes_price_check
        CHECK (price IS NULL OR price >= 0),
    CONSTRAINT volumes_price_currency_check
        CHECK (price_currency IN ('R$', 'CR$', 'Cr$', 'NCz$', 'Cz$')),
    CONSTRAINT volumes_release_precision_check
        CHECK (release_date_precision IN ('Completa', 'Mes e ano', 'Ano', 'Desconhecida')),
    CONSTRAINT volumes_release_month_check
        CHECK (release_month IS NULL OR (release_month >= 1 AND release_month <= 12)),
    CONSTRAINT volumes_release_day_check
        CHECK (release_day IS NULL OR (release_day >= 1 AND release_day <= 31)),
    CONSTRAINT volumes_edition_number_unique
        UNIQUE (edition_id, number)
);

CREATE INDEX idx_volumes_edition_number
    ON volumes (edition_id, number);

CREATE INDEX idx_volumes_visibility
    ON volumes (visibility);
