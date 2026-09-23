CREATE TABLE "edition_papers" (
    "edition_id" INTEGER NOT NULL,
    "paper_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "edition_papers_pkey" PRIMARY KEY ("edition_id", "paper_id")
);

INSERT INTO "edition_papers" ("edition_id", "paper_id", "position")
SELECT "id", "paper_id", 0
FROM "editions"
WHERE "paper_id" IS NOT NULL;

CREATE INDEX "idx_edition_papers_paper" ON "edition_papers"("paper_id");
CREATE INDEX "idx_edition_papers_edition_position" ON "edition_papers"("edition_id", "position");

ALTER TABLE "edition_papers"
ADD CONSTRAINT "edition_papers_edition_id_fkey"
FOREIGN KEY ("edition_id") REFERENCES "editions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "edition_papers"
ADD CONSTRAINT "edition_papers_paper_id_fkey"
FOREIGN KEY ("paper_id") REFERENCES "domain_option_values"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "idx_editions_visibility_paper";
ALTER TABLE "editions" DROP CONSTRAINT "editions_paper_id_fkey";
ALTER TABLE "editions" DROP COLUMN "paper_id";
