// Estrutura anterior, recriada somente dentro de testes de migrations históricas.
const legacyCountrySchema = `
ALTER TABLE works ADD COLUMN IF NOT EXISTS country VARCHAR(40) NOT NULL DEFAULT 'Japão';
CREATE INDEX IF NOT EXISTS idx_works_country ON works(country);
DROP INDEX IF EXISTS idx_works_public_filters;
CREATE INDEX idx_works_public_filters ON works(visibility, adult_content, type_id, country, id);
CREATE TABLE IF NOT EXISTS domain_option_value_dependencies (
    dependent_value_id INTEGER NOT NULL REFERENCES domain_option_values(id) ON DELETE CASCADE,
    depends_on_value_id INTEGER NOT NULL REFERENCES domain_option_values(id) ON DELETE RESTRICT,
    PRIMARY KEY(dependent_value_id, depends_on_value_id)
);
CREATE INDEX IF NOT EXISTS idx_domain_option_dependencies_depends_on
    ON domain_option_value_dependencies(depends_on_value_id);
INSERT INTO domain_option_categories(slug,name) VALUES('paises-origem','País de origem')
    ON CONFLICT(slug) DO NOTHING;
INSERT INTO domain_option_values(category_id,label)
    SELECT category.id, country.label
    FROM domain_option_categories category,
        (VALUES ('Japão'),('Coreia do Sul'),('China'),('Taiwan')) AS country(label)
    WHERE category.slug='paises-origem'
      AND NOT EXISTS (SELECT 1 FROM domain_option_values existing
          WHERE existing.category_id=category.id AND existing.label=country.label);
`;

module.exports = { legacyCountrySchema };
