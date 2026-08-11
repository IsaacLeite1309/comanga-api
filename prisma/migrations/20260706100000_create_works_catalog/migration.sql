CREATE TABLE works (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    original_publication_start_year INTEGER,
    original_publication_end_year INTEGER,
    original_volume_count INTEGER,
    direct_release BOOLEAN NOT NULL DEFAULT FALSE,
    type_id INTEGER NOT NULL,
    country_id INTEGER NOT NULL,
    original_publication_status_id INTEGER,
    cover_url VARCHAR(2048),
    visibility VARCHAR(20) NOT NULL DEFAULT 'Privado',
    adult_content BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT works_type_id_fkey
        FOREIGN KEY (type_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
    CONSTRAINT works_country_id_fkey
        FOREIGN KEY (country_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
    CONSTRAINT works_original_publication_status_id_fkey
        FOREIGN KEY (original_publication_status_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
    CONSTRAINT works_visibility_check
        CHECK (visibility IN ('Privado', 'Público'))
);

CREATE UNIQUE INDEX works_title_unique
    ON works (LOWER(title));

CREATE INDEX idx_works_title
    ON works (title);

CREATE INDEX idx_works_type
    ON works (type_id);

CREATE INDEX idx_works_country
    ON works (country_id);

CREATE INDEX idx_works_visibility
    ON works (visibility);

CREATE TABLE work_authors (
    work_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    CONSTRAINT work_authors_pkey
        PRIMARY KEY (work_id, author_id, role_id),
    CONSTRAINT work_authors_work_id_fkey
        FOREIGN KEY (work_id)
        REFERENCES works(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT work_authors_author_id_fkey
        FOREIGN KEY (author_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
    CONSTRAINT work_authors_role_id_fkey
        FOREIGN KEY (role_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE INDEX idx_work_authors_author
    ON work_authors (author_id);

CREATE UNIQUE INDEX work_authors_work_author_unique
    ON work_authors (work_id, author_id);

CREATE INDEX idx_work_authors_role
    ON work_authors (role_id);

CREATE TABLE work_genres (
    work_id INTEGER NOT NULL,
    genre_id INTEGER NOT NULL,
    CONSTRAINT work_genres_pkey
        PRIMARY KEY (work_id, genre_id),
    CONSTRAINT work_genres_work_id_fkey
        FOREIGN KEY (work_id)
        REFERENCES works(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT work_genres_genre_id_fkey
        FOREIGN KEY (genre_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE INDEX idx_work_genres_genre
    ON work_genres (genre_id);

CREATE TABLE work_demographies (
    work_id INTEGER NOT NULL,
    demography_id INTEGER NOT NULL,
    CONSTRAINT work_demographies_pkey
        PRIMARY KEY (work_id, demography_id),
    CONSTRAINT work_demographies_work_id_fkey
        FOREIGN KEY (work_id)
        REFERENCES works(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT work_demographies_demography_id_fkey
        FOREIGN KEY (demography_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE INDEX idx_work_demographies_demography
    ON work_demographies (demography_id);

CREATE TABLE work_serialization_magazines (
    work_id INTEGER NOT NULL,
    magazine_id INTEGER NOT NULL,
    CONSTRAINT work_serialization_magazines_pkey
        PRIMARY KEY (work_id, magazine_id),
    CONSTRAINT work_serialization_magazines_work_id_fkey
        FOREIGN KEY (work_id)
        REFERENCES works(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT work_serialization_magazines_magazine_id_fkey
        FOREIGN KEY (magazine_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE INDEX idx_work_serialization_magazines_magazine
    ON work_serialization_magazines (magazine_id);
