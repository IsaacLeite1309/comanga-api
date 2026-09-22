INSERT INTO "domain_option_categories" ("slug", "name")
VALUES ('miolos', 'Miolo')
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "domain_option_values" ("category_id", "label", "active")
SELECT category."id", 'Papel', true
FROM "domain_option_categories" AS category
WHERE category."slug" = 'miolos'
  AND NOT EXISTS (
    SELECT 1
    FROM "domain_option_values" AS value
    WHERE value."category_id" = category."id"
      AND LOWER(value."label") = LOWER('Papel')
  );

ALTER TABLE "editions" ADD COLUMN "paper_id" INTEGER;

UPDATE "editions"
SET "paper_id" = (
  SELECT value."id"
  FROM "domain_option_values" AS value
  INNER JOIN "domain_option_categories" AS category ON category."id" = value."category_id"
  WHERE category."slug" = 'miolos'
    AND LOWER(value."label") = LOWER('Papel')
  ORDER BY value."id"
  LIMIT 1
);

ALTER TABLE "editions" ALTER COLUMN "paper_id" SET NOT NULL;

ALTER TABLE "editions"
ADD CONSTRAINT "editions_paper_id_fkey"
FOREIGN KEY ("paper_id") REFERENCES "domain_option_values"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "idx_editions_visibility_paper" ON "editions"("visibility", "paper_id", "id");
