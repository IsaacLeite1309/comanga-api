-- Metadados proprios da Obra: titulo romanizado e sinopse.
-- O preenchimento inicial com o titulo em portugues e transitorio; cada Obra
-- existente precisa de revisao editorial manual depois da aplicacao.
ALTER TABLE works
    ADD COLUMN IF NOT EXISTS romanized_title VARCHAR(255);

ALTER TABLE works
    ADD COLUMN IF NOT EXISTS synopsis TEXT;

UPDATE works
SET romanized_title = title
WHERE romanized_title IS NULL OR BTRIM(romanized_title) = '';

UPDATE works
SET synopsis = title
WHERE synopsis IS NULL OR BTRIM(synopsis) = '';

ALTER TABLE works
    ALTER COLUMN romanized_title SET NOT NULL;

ALTER TABLE works
    ALTER COLUMN synopsis SET NOT NULL;

-- O titulo romanizado participa da busca publica, como titulo e titulo original.
CREATE INDEX IF NOT EXISTS idx_works_romanized_title_trgm
    ON works USING GIN (romanized_title gin_trgm_ops);

-- Ordem editorial explicita dos creditos, na mesma convencao de editoras e
-- revistas: posicoes contiguas a partir de 0 dentro de cada Obra.
ALTER TABLE work_authors
    ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Backfill deterministico: ordem alfabetica do rotulo do Autor, desempatada
-- pelo identificador. Obras que ja possuam alguma posicao diferente de zero
-- sao preservadas, para nao descartar uma ordem definida pelo administrador.
UPDATE work_authors AS link
SET position = ordered.position
FROM (
    SELECT
        work_author.work_id,
        work_author.author_id,
        ROW_NUMBER() OVER (
            PARTITION BY work_author.work_id
            ORDER BY author_option.label ASC, work_author.author_id ASC
        ) - 1 AS position
    FROM work_authors AS work_author
    JOIN domain_option_values AS author_option
      ON author_option.id = work_author.author_id
) AS ordered
WHERE link.work_id = ordered.work_id
  AND link.author_id = ordered.author_id
  AND NOT EXISTS (
      SELECT 1
      FROM work_authors AS existing
      WHERE existing.work_id = link.work_id
        AND existing.position <> 0
  );

CREATE INDEX IF NOT EXISTS idx_work_authors_position
    ON work_authors (work_id, position);
