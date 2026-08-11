UPDATE domain_option_categories
SET slug = 'editoras-originais',
    name = 'Editora original'
WHERE slug = 'editoras-japonesas';

UPDATE domain_option_categories
SET name = 'Editora original'
WHERE slug = 'editoras-originais';
