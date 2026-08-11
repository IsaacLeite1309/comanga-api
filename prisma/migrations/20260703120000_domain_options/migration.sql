CREATE TABLE domain_option_categories (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE domain_option_values (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL,
    label VARCHAR(120) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT domain_option_values_category_id_fkey
        FOREIGN KEY (category_id)
        REFERENCES domain_option_categories(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX domain_option_values_category_label_unique
    ON domain_option_values (category_id, LOWER(label));

CREATE INDEX idx_domain_option_values_category_label
    ON domain_option_values (category_id, label);

CREATE INDEX idx_domain_option_values_category_active_label
    ON domain_option_values (category_id, active, label);

CREATE TABLE domain_option_value_dependencies (
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

CREATE INDEX idx_domain_option_dependencies_depends_on
    ON domain_option_value_dependencies (depends_on_value_id);

INSERT INTO domain_option_categories (slug, name) VALUES
    ('autores', 'Autor'),
    ('papeis-autoria', 'Papel do autor'),
    ('tipos-obra', 'Tipo de obra'),
    ('paises-origem', 'País de origem'),
    ('demografias', 'Demografia'),
    ('generos', 'Gêneros'),
    ('status-publicacao-original', 'Status de publicação original'),
    ('revistas-serializacao', 'Revista de serialização'),
    ('editoras-originais', 'Editora original'),
    ('editoras-brasileiras', 'Editora brasileira'),
    ('tipos-edicao', 'Tipo de edição'),
    ('tipos-capa', 'Acabamento'),
    ('formatos-fisicos', 'Formato'),
    ('miolos', 'Miolo'),
    ('numeros-cronologicos-edicao', 'Número cronológico da edição'),
    ('status-publicacao-brasil', 'Status de publicação no Brasil');
