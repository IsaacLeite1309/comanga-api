-- Classificações — classificações controladas do catálogo (seções 11 a 14 do guia).
-- Todo o arquivo é idempotente: reexecutá-lo não duplica valores, não troca ids
-- e não remove associações existentes. Nenhum valor de domínio é excluído aqui.

ALTER TABLE domain_option_values
    ADD COLUMN IF NOT EXISTS code VARCHAR(80),
    ADD COLUMN IF NOT EXISTS system_managed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_option_values_category_code
    ON domain_option_values (category_id, code);

CREATE INDEX IF NOT EXISTS idx_domain_option_values_category_position
    ON domain_option_values (category_id, "position", label);

-- Normalização auxiliar: ignora caixa, acentuação e apóstrofos (ASCII ou tipográfico)
-- para casar os rótulos já existentes com os oficiais sem trocar seus ids.
CREATE OR REPLACE FUNCTION comanga_normalize_option_label(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT lower(btrim(translate(
        value,
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç’''`´',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
    )));
$function$;

-- As categorias controladas precisam existir antes da semeadura.
INSERT INTO domain_option_categories (slug, name)
VALUES ('tipos-obra', 'Tipo de Obra'), ('generos', 'Gênero')
ON CONFLICT (slug) DO NOTHING;

-- Tipos de Obra oficiais: casa por código ou por rótulo normalizado, preservando o id.
DO $seed_types$
DECLARE
    category_id_value INTEGER;
    official RECORD;
    matched_id INTEGER;
BEGIN
    SELECT id INTO category_id_value FROM domain_option_categories WHERE slug = 'tipos-obra';

    FOR official IN
        SELECT * FROM (VALUES
            ('artbook', 'Artbook', 5),
            ('databook', 'Databook', 6),
            ('light-novel', 'Light Novel', 3),
            ('manga', 'Mangá', 0),
            ('manhua', 'Manhua', 2),
            ('manhwa', 'Manhwa', 1),
            ('novel', 'Novel', 4)
        ) AS t(option_code, option_label, option_position)
    LOOP
        SELECT id INTO matched_id
        FROM domain_option_values
        WHERE category_id = category_id_value
          AND (
              code = official.option_code
              OR comanga_normalize_option_label(label) = comanga_normalize_option_label(official.option_label)
          )
        -- A unicidade histórica usa LOWER(label), sem remover acentos/apóstrofos.
        -- Prefere o nome canônico já ocupado e mantém os outros ids como legados.
        ORDER BY (code IS NOT DISTINCT FROM official.option_code) DESC,
            (lower(label) = lower(official.option_label)) DESC, id ASC
        LIMIT 1;

        IF matched_id IS NULL THEN
            INSERT INTO domain_option_values (category_id, label, code, system_managed, "position", active)
            VALUES (category_id_value, official.option_label, official.option_code, TRUE, official.option_position, TRUE);
            RAISE NOTICE 'Classificações: tipo de Obra oficial criado: %.', official.option_label;
        ELSE
            UPDATE domain_option_values
            SET label = official.option_label,
                code = official.option_code,
                system_managed = TRUE,
                "position" = official.option_position
            WHERE id = matched_id;
        END IF;

        matched_id := NULL;
    END LOOP;
END
$seed_types$;

-- Gêneros oficiais na ordem de exibição definida pelo guia (posição a partir de 0).
DO $seed_genres$
DECLARE
    category_id_value INTEGER;
    official RECORD;
    matched_id INTEGER;
BEGIN
    SELECT id INTO category_id_value FROM domain_option_categories WHERE slug = 'generos';

    FOR official IN
        SELECT * FROM (VALUES
            ('aventura', 'Aventura', 0),
            ('acao', 'Ação', 1),
            ('boys-love', 'Boys’ Love', 2),
            ('comedia', 'Comédia', 3),
            ('drama', 'Drama', 4),
            ('ecchi', 'Ecchi', 5),
            ('esportes', 'Esportes', 6),
            ('fantasia', 'Fantasia', 7),
            ('ficcao-cientifica', 'Ficção Científica', 8),
            ('girls-love', 'Girls’ Love', 9),
            ('hentai', 'Hentai', 10),
            ('mahou-shoujo', 'Mahou Shoujo', 11),
            ('mecha', 'Mecha', 12),
            ('misterio', 'Mistério', 13),
            ('musica', 'Música', 14),
            ('psicologico', 'Psicológico', 15),
            ('romance', 'Romance', 16),
            ('slice-of-life', 'Slice of Life', 17),
            ('sobrenatural', 'Sobrenatural', 18),
            ('suspense', 'Suspense', 19),
            ('terror', 'Terror', 20)
        ) AS t(option_code, option_label, option_position)
    LOOP
        SELECT id INTO matched_id
        FROM domain_option_values
        WHERE category_id = category_id_value
          AND (
              code = official.option_code
              OR comanga_normalize_option_label(label) = comanga_normalize_option_label(official.option_label)
          )
        ORDER BY (code IS NOT DISTINCT FROM official.option_code) DESC,
            (lower(label) = lower(official.option_label)) DESC, id ASC
        LIMIT 1;

        IF matched_id IS NULL THEN
            INSERT INTO domain_option_values (category_id, label, code, system_managed, "position", active)
            VALUES (category_id_value, official.option_label, official.option_code, TRUE, official.option_position, TRUE);
            RAISE NOTICE 'Classificações: gênero oficial criado: %.', official.option_label;
        ELSE
            UPDATE domain_option_values
            SET label = official.option_label,
                code = official.option_code,
                system_managed = TRUE,
                "position" = official.option_position
            WHERE id = matched_id;
        END IF;

        matched_id := NULL;
    END LOOP;
END
$seed_genres$;

-- Dependências tipo→país: remove o que divergir da tabela oficial e reporta a remoção.
DO $prune_dependencies$
DECLARE
    divergent RECORD;
BEGIN
    FOR divergent IN
        SELECT
            dependency.dependent_value_id,
            dependency.depends_on_value_id,
            work_type.label AS type_label,
            country.label AS country_label
        FROM domain_option_value_dependencies dependency
        JOIN domain_option_values work_type ON work_type.id = dependency.dependent_value_id
        JOIN domain_option_categories type_category
            ON type_category.id = work_type.category_id AND type_category.slug = 'tipos-obra'
        JOIN domain_option_values country ON country.id = dependency.depends_on_value_id
        JOIN domain_option_categories country_category
            ON country_category.id = country.category_id AND country_category.slug = 'paises-origem'
        WHERE work_type.system_managed
          AND NOT EXISTS (
              SELECT 1
              FROM (VALUES
                    ('artbook', 'Japão'),
                    ('databook', 'Japão'),
                    ('light-novel', 'Japão'),
                    ('manga', 'Japão'),
                    ('manhua', 'China'),
                    ('manhua', 'Taiwan'),
                    ('manhwa', 'Coreia do Sul'),
                    ('novel', 'China'),
                    ('novel', 'Coreia do Sul'),
                    ('novel', 'Japão'),
                    ('novel', 'Taiwan')
              ) AS official(type_code, country_label)
              WHERE official.type_code = work_type.code
                AND comanga_normalize_option_label(official.country_label)
                    = comanga_normalize_option_label(country.label)
          )
    LOOP
        RAISE NOTICE 'Classificações: dependência não oficial removida do tipo "%" com o país "%".',
            divergent.type_label, divergent.country_label;
        DELETE FROM domain_option_value_dependencies
        WHERE dependent_value_id = divergent.dependent_value_id
          AND depends_on_value_id = divergent.depends_on_value_id;
    END LOOP;
END
$prune_dependencies$;

INSERT INTO domain_option_value_dependencies (dependent_value_id, depends_on_value_id)
SELECT work_type.id, country.id
FROM (VALUES
            ('artbook', 'Japão'),
            ('databook', 'Japão'),
            ('light-novel', 'Japão'),
            ('manga', 'Japão'),
            ('manhua', 'China'),
            ('manhua', 'Taiwan'),
            ('manhwa', 'Coreia do Sul'),
            ('novel', 'China'),
            ('novel', 'Coreia do Sul'),
            ('novel', 'Japão'),
            ('novel', 'Taiwan')
) AS official(type_code, country_label)
JOIN domain_option_values work_type ON work_type.code = official.type_code
JOIN domain_option_categories type_category
    ON type_category.id = work_type.category_id AND type_category.slug = 'tipos-obra'
JOIN domain_option_categories country_category ON country_category.slug = 'paises-origem'
JOIN domain_option_values country
    ON country.category_id = country_category.id
   AND comanga_normalize_option_label(country.label)
       = comanga_normalize_option_label(official.country_label)
ON CONFLICT DO NOTHING;

-- Obra associada a Hentai nunca pode permanecer como não adulta.
DO $normalize_adult$
DECLARE
    normalized INTEGER;
BEGIN
    UPDATE works
    SET adult_content = TRUE
    WHERE adult_content = FALSE
      AND EXISTS (
          SELECT 1
          FROM work_genres
          JOIN domain_option_values genre ON genre.id = work_genres.genre_id
          JOIN domain_option_categories genre_category
              ON genre_category.id = genre.category_id AND genre_category.slug = 'generos'
          WHERE work_genres.work_id = works.id AND genre.code = 'hentai'
      );

    GET DIAGNOSTICS normalized = ROW_COUNT;

    IF normalized > 0 THEN
        RAISE NOTICE 'Classificações: % Obra(s) com Hentai tiveram adult_content normalizado para TRUE.', normalized;
    END IF;
END
$normalize_adult$;

-- Valores antigos sem correspondência oficial permanecem intactos e são apenas reportados.
DO $report_legacy$
DECLARE
    legacy RECORD;
BEGIN
    FOR legacy IN
        SELECT value.id, value.label, category.slug
        FROM domain_option_values value
        JOIN domain_option_categories category ON category.id = value.category_id
        WHERE category.slug IN ('tipos-obra', 'generos')
          AND value.system_managed = FALSE
        ORDER BY category.slug, value.label
    LOOP
        RAISE NOTICE 'Classificações: valor sem correspondência oficial mantido intacto — categoria %, id %, rótulo "%". O responsável decidirá seu destino.',
            legacy.slug, legacy.id, legacy.label;
    END LOOP;
END
$report_legacy$;

DROP FUNCTION IF EXISTS comanga_normalize_option_label(TEXT);
