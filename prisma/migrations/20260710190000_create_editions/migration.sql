CREATE TABLE editions (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL,
    brazilian_publisher_id INTEGER NOT NULL,
    edition_type_id INTEGER NOT NULL,
    cover_type_id INTEGER NOT NULL,
    format_id INTEGER NOT NULL,
    chronological_number INTEGER NOT NULL,
    brazil_publication_status_id INTEGER NOT NULL,
    cover_url VARCHAR(2048),
    visibility VARCHAR(20) NOT NULL DEFAULT 'Privado',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT editions_work_id_fkey
        FOREIGN KEY (work_id)
        REFERENCES works(id)
        ON DELETE RESTRICT,
    CONSTRAINT editions_brazilian_publisher_id_fkey
        FOREIGN KEY (brazilian_publisher_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT,
    CONSTRAINT editions_edition_type_id_fkey
        FOREIGN KEY (edition_type_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT,
    CONSTRAINT editions_cover_type_id_fkey
        FOREIGN KEY (cover_type_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT,
    CONSTRAINT editions_format_id_fkey
        FOREIGN KEY (format_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT,
    CONSTRAINT editions_brazil_publication_status_id_fkey
        FOREIGN KEY (brazil_publication_status_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT,
    CONSTRAINT editions_visibility_check
        CHECK (visibility IN ('Privado', 'Público')),
    CONSTRAINT editions_chronological_number_check
        CHECK (chronological_number > 0),
    CONSTRAINT editions_work_chronological_number_unique
        UNIQUE (work_id, chronological_number)
);

CREATE INDEX idx_editions_work_chronological
    ON editions (work_id, chronological_number);

CREATE INDEX idx_editions_visibility
    ON editions (visibility);
