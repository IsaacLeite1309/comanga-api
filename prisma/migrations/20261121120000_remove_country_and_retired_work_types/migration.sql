-- Remoção definitiva de país de origem e dos tipos Manhwa/Manhua ainda sem uso.
-- Um único bloco torna validações, dados e alterações de estrutura atômicos.
DO $remove_country$
DECLARE
    removed_type_ids INTEGER[];
    linked_works INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(9142026);
    LOCK TABLE works IN ACCESS EXCLUSIVE MODE;

    SELECT COALESCE(array_agg(value.id), ARRAY[]::INTEGER[])
    INTO removed_type_ids
    FROM domain_option_values value
    JOIN domain_option_categories category ON category.id = value.category_id
    WHERE category.slug = 'tipos-obra'
      AND (value.code IN ('manhwa', 'manhua')
        OR lower(btrim(value.label)) IN ('manhwa', 'manhua', 'manhwas', 'manhuas'));

    PERFORM id FROM domain_option_values WHERE id = ANY(removed_type_ids) FOR UPDATE;
    SELECT COUNT(*) INTO linked_works FROM works WHERE type_id = ANY(removed_type_ids);
    IF linked_works > 0 THEN
        RAISE EXCEPTION 'Não foi possível remover Manhwa/Manhua: existem % Obras vinculadas. Revise a classificação antes de aplicar esta migration.', linked_works;
    END IF;

    IF to_regclass('domain_option_value_dependencies') IS NOT NULL THEN
        -- Esta tabela servia aos países. Não excluir silenciosamente um uso diferente.
        IF EXISTS (
            SELECT 1 FROM domain_option_value_dependencies dependency
            JOIN domain_option_values value ON value.id = dependency.depends_on_value_id
            JOIN domain_option_categories category ON category.id = value.category_id
            WHERE category.slug <> 'paises-origem'
        ) THEN
            RAISE EXCEPTION 'Existem dependências de opções que não são de país. Revise esses vínculos antes de aplicar esta migration.';
        END IF;
        DROP TABLE domain_option_value_dependencies;
    END IF;

    DELETE FROM domain_option_values WHERE id = ANY(removed_type_ids);
    DELETE FROM domain_option_values
    WHERE category_id IN (SELECT id FROM domain_option_categories WHERE slug = 'paises-origem');
    DELETE FROM domain_option_categories WHERE slug = 'paises-origem';

    DROP INDEX IF EXISTS idx_works_public_filters;
    DROP INDEX IF EXISTS idx_works_country;
    ALTER TABLE works DROP COLUMN IF EXISTS country;
    CREATE INDEX idx_works_public_filters ON works (visibility, adult_content, type_id, id);

    UPDATE domain_option_values value
    SET position = official.position
    FROM domain_option_categories category,
         (VALUES ('manga', 0), ('light-novel', 1), ('novel', 2), ('artbook', 3), ('databook', 4))
         AS official(code, position)
    WHERE category.id = value.category_id AND category.slug = 'tipos-obra'
      AND value.code = official.code;
END
$remove_country$;
