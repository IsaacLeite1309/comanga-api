ALTER TABLE works
    ADD COLUMN country VARCHAR(40),
    ADD COLUMN original_publication_status VARCHAR(40);

UPDATE works
SET country = COALESCE((
    SELECT CASE
        WHEN dov.label IN ('Japão', 'Japao') THEN 'Japão'
        WHEN dov.label IN ('Coreia do Sul', 'Coreia') THEN 'Coreia do Sul'
        WHEN dov.label = 'China' THEN 'China'
        WHEN dov.label = 'Taiwan' THEN 'Taiwan'
        ELSE dov.label
    END
    FROM domain_option_values dov
    WHERE dov.id = works.country_id
), 'Japão');

UPDATE works
SET original_publication_status = COALESCE((
    SELECT CASE
        WHEN dov.label IN ('Completo', 'Finalizada', 'Finalizado') THEN 'Completo'
        WHEN dov.label IN ('Em andamento', 'Andamento') THEN 'Em andamento'
        WHEN dov.label IN ('Em hiato', 'Hiato') THEN 'Em hiato'
        WHEN dov.label = 'Cancelado' THEN 'Cancelado'
        ELSE dov.label
    END
    FROM domain_option_values dov
    WHERE dov.id = works.original_publication_status_id
), 'Completo');

ALTER TABLE works
    ALTER COLUMN country SET NOT NULL,
    ALTER COLUMN original_publication_status SET NOT NULL;

ALTER TABLE works
    DROP CONSTRAINT IF EXISTS works_country_id_fkey,
    DROP CONSTRAINT IF EXISTS works_original_publication_status_id_fkey,
    ADD CONSTRAINT works_country_check
        CHECK (country IN ('Japão', 'Coreia do Sul', 'China', 'Taiwan')),
    ADD CONSTRAINT works_original_publication_status_check
        CHECK (original_publication_status IN ('Completo', 'Em andamento', 'Em hiato', 'Cancelado'));

DROP INDEX IF EXISTS idx_works_country;

ALTER TABLE works
    DROP COLUMN IF EXISTS country_id,
    DROP COLUMN IF EXISTS original_publication_status_id;

CREATE INDEX idx_works_country
    ON works (country);

CREATE INDEX idx_works_original_publication_status
    ON works (original_publication_status);

CREATE TABLE work_author_roles (
    work_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    role VARCHAR(40) NOT NULL,
    CONSTRAINT work_author_roles_pkey
        PRIMARY KEY (work_id, author_id, role),
    CONSTRAINT work_author_roles_work_author_fkey
        FOREIGN KEY (work_id, author_id)
        REFERENCES work_authors(work_id, author_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT work_author_roles_role_check
        CHECK (role IN ('História e Arte', 'História', 'Arte', 'Criador Original', 'História Original', 'Ilustrador'))
);

INSERT INTO work_author_roles (work_id, author_id, role)
SELECT
    wa.work_id,
    wa.author_id,
    CASE
        WHEN dov.label IN ('História e Arte', 'Roteiro e Arte') THEN 'História e Arte'
        WHEN dov.label IN ('História', 'Roteiro') THEN 'História'
        WHEN dov.label = 'Arte' THEN 'Arte'
        WHEN dov.label = 'Criador Original' THEN 'Criador Original'
        WHEN dov.label = 'História Original' THEN 'História Original'
        WHEN dov.label = 'Ilustrador' THEN 'Ilustrador'
        ELSE 'História e Arte'
    END
FROM work_authors wa
JOIN domain_option_values dov ON dov.id = wa.role_id
ON CONFLICT DO NOTHING;

ALTER TABLE work_authors
    DROP CONSTRAINT IF EXISTS work_authors_role_id_fkey;

DROP INDEX IF EXISTS idx_work_authors_role;

ALTER TABLE work_authors
    DROP CONSTRAINT IF EXISTS work_authors_pkey,
    DROP COLUMN IF EXISTS role_id,
    ADD CONSTRAINT work_authors_pkey PRIMARY KEY (work_id, author_id);

ALTER TABLE work_demographies
    ADD COLUMN demography VARCHAR(40);

UPDATE work_demographies
SET demography = COALESCE((
    SELECT CASE
        WHEN dov.label IN ('Shonen', 'Shounen') THEN 'Shonen'
        WHEN dov.label IN ('Shoujo', 'Shojo') THEN 'Shoujo'
        WHEN dov.label = 'Seinen' THEN 'Seinen'
        WHEN dov.label = 'Josei' THEN 'Josei'
        WHEN dov.label = 'Kodomo' THEN 'Kodomo'
        ELSE dov.label
    END
    FROM domain_option_values dov
    WHERE dov.id = work_demographies.demography_id
), 'Shonen');

ALTER TABLE work_demographies
    ALTER COLUMN demography SET NOT NULL,
    DROP CONSTRAINT IF EXISTS work_demographies_demography_id_fkey,
    ADD CONSTRAINT work_demographies_demography_check
        CHECK (demography IN ('Shonen', 'Shoujo', 'Seinen', 'Josei', 'Kodomo'));

DROP INDEX IF EXISTS idx_work_demographies_demography;

ALTER TABLE work_demographies
    DROP CONSTRAINT IF EXISTS work_demographies_pkey,
    DROP COLUMN IF EXISTS demography_id,
    ADD CONSTRAINT work_demographies_pkey PRIMARY KEY (work_id, demography);

CREATE INDEX idx_work_demographies_demography
    ON work_demographies (demography);
