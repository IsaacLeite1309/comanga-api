INSERT INTO domain_option_categories (slug, name)
VALUES ('paises-origem', 'País de origem')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name;

WITH country_category AS (
    SELECT id
    FROM domain_option_categories
    WHERE slug = 'paises-origem'
)
INSERT INTO domain_option_values (category_id, label, active)
SELECT country_category.id, country.label, TRUE
FROM country_category
CROSS JOIN (
    VALUES
        ('Japão'),
        ('Coreia do Sul'),
        ('China'),
        ('Taiwan')
) AS country(label)
WHERE NOT EXISTS (
    SELECT 1
    FROM domain_option_values existing_value
    WHERE existing_value.category_id = country_category.id
    AND LOWER(existing_value.label) = LOWER(country.label)
);

UPDATE domain_option_values
SET active = TRUE
WHERE category_id = (
    SELECT id
    FROM domain_option_categories
    WHERE slug = 'paises-origem'
)
AND label IN ('Japão', 'Coreia do Sul', 'China', 'Taiwan');
