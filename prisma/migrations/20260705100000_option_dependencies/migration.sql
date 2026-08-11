CREATE TABLE IF NOT EXISTS domain_option_value_dependencies (
    dependent_value_id INTEGER NOT NULL,
    depends_on_value_id INTEGER NOT NULL,
    CONSTRAINT domain_option_value_dependencies_pkey
        PRIMARY KEY (dependent_value_id, depends_on_value_id),
    CONSTRAINT domain_option_value_dependencies_dependent_value_id_fkey
        FOREIGN KEY (dependent_value_id)
        REFERENCES domain_option_values(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT domain_option_value_dependencies_depends_on_value_id_fkey
        FOREIGN KEY (depends_on_value_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domain_option_dependencies_depends_on
    ON domain_option_value_dependencies (depends_on_value_id);

UPDATE domain_option_categories
SET name = 'Autor'
WHERE slug = 'autores';

UPDATE domain_option_categories
SET name = 'Papel do autor'
WHERE slug = 'papeis-autoria';

UPDATE domain_option_categories
SET name = 'Tipo de obra'
WHERE slug = 'tipos-obra';

UPDATE domain_option_categories
SET name = 'País de origem'
WHERE slug = 'paises-origem';

UPDATE domain_option_categories
SET name = 'Demografia'
WHERE slug = 'demografias';

UPDATE domain_option_categories
SET name = 'Gêneros'
WHERE slug = 'generos';

UPDATE domain_option_categories
SET name = 'Status de publicação original'
WHERE slug = 'status-publicacao-original';

UPDATE domain_option_categories
SET name = 'Revista de serialização'
WHERE slug = 'revistas-serializacao';

UPDATE domain_option_categories
SET slug = 'editoras-originais',
    name = 'Editora original'
WHERE slug = 'editoras-japonesas';

UPDATE domain_option_categories
SET name = 'Editora original'
WHERE slug = 'editoras-originais';

UPDATE domain_option_categories
SET name = 'Editora brasileira'
WHERE slug = 'editoras-brasileiras';

UPDATE domain_option_categories
SET name = 'Tipo de edição'
WHERE slug = 'tipos-edicao';

UPDATE domain_option_categories
SET name = 'Acabamento'
WHERE slug = 'tipos-capa';

UPDATE domain_option_categories
SET name = 'Formato'
WHERE slug = 'formatos-fisicos';

INSERT INTO domain_option_categories (slug, name)
VALUES ('miolos', 'Miolo')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

UPDATE domain_option_categories
SET name = 'Número cronológico da edição'
WHERE slug = 'numeros-cronologicos-edicao';

UPDATE domain_option_categories
SET name = 'Status de publicação no Brasil'
WHERE slug = 'status-publicacao-brasil';
