UPDATE domain_option_categories
SET name = 'Acabamento'
WHERE slug = 'tipos-capa';

UPDATE domain_option_categories
SET name = 'Formato'
WHERE slug = 'formatos-fisicos';

INSERT INTO domain_option_categories (slug, name)
VALUES ('miolos', 'Miolo')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;
