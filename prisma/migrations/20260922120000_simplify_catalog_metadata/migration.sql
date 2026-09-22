-- Os dados removidos são descartáveis por decisão do catálogo.
-- DROP COLUMN também remove os índices locais que dependem da coluna.
ALTER TABLE editions DROP CONSTRAINT editions_edition_type_id_fkey;
ALTER TABLE editions DROP COLUMN edition_type_id;
ALTER TABLE works DROP COLUMN original_volume_count;

DELETE FROM domain_option_value_dependencies
WHERE dependent_value_id IN (
    SELECT value.id FROM domain_option_values value
    JOIN domain_option_categories category ON category.id = value.category_id
    WHERE category.slug = 'tipos-edicao'
) OR depends_on_value_id IN (
    SELECT value.id FROM domain_option_values value
    JOIN domain_option_categories category ON category.id = value.category_id
    WHERE category.slug = 'tipos-edicao'
);
DELETE FROM domain_option_values WHERE category_id IN (
    SELECT id FROM domain_option_categories WHERE slug = 'tipos-edicao'
);
DELETE FROM domain_option_categories WHERE slug = 'tipos-edicao';
