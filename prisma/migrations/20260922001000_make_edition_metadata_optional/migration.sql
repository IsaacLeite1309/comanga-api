ALTER TABLE "editions"
ALTER COLUMN "edition_type_id" DROP NOT NULL,
ALTER COLUMN "cover_type_id" DROP NOT NULL,
ALTER COLUMN "format_id" DROP NOT NULL,
ALTER COLUMN "paper_id" DROP NOT NULL;

-- A migration anterior usou "Papel" apenas como valor técnico temporário.
-- Como miolo pode ser desconhecido, esses valores antigos voltam a ser ausência de dado.
UPDATE "editions"
SET "paper_id" = NULL
WHERE "paper_id" = (
  SELECT value."id"
  FROM "domain_option_values" AS value
  INNER JOIN "domain_option_categories" AS category ON category."id" = value."category_id"
  WHERE category."slug" = 'miolos'
    AND LOWER(value."label") = LOWER('Papel')
  ORDER BY value."id"
  LIMIT 1
);
