ALTER TABLE works
    DROP CONSTRAINT IF EXISTS works_original_publication_status_check;

ALTER TABLE editions
    DROP CONSTRAINT IF EXISTS editions_brazil_publication_status_check;

UPDATE works
SET original_publication_status = CASE original_publication_status
    WHEN 'Completo' THEN 'Completa'
    WHEN 'Cancelado' THEN 'Cancelada'
    ELSE original_publication_status
END
WHERE original_publication_status IN ('Completo', 'Cancelado');

UPDATE editions
SET brazil_publication_status = CASE brazil_publication_status
    WHEN 'Completo' THEN 'Completa'
    WHEN 'Cancelado' THEN 'Cancelada'
    ELSE brazil_publication_status
END
WHERE brazil_publication_status IN ('Completo', 'Cancelado');

ALTER TABLE works
    ADD CONSTRAINT works_original_publication_status_check
        CHECK (original_publication_status IN ('Completa', 'Em andamento', 'Em hiato', 'Cancelada'));

ALTER TABLE editions
    ADD CONSTRAINT editions_brazil_publication_status_check
        CHECK (brazil_publication_status IN ('Completa', 'Em andamento', 'Em hiato', 'Cancelada'));
