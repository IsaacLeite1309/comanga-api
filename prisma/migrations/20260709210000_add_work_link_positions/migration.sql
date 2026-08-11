ALTER TABLE "work_original_publishers"
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "work_serialization_magazines"
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "work_original_publishers" AS link
SET "position" = ordered.position
FROM (
    SELECT
        work_id,
        publisher_id,
        ROW_NUMBER() OVER (PARTITION BY work_id ORDER BY publisher_id) - 1 AS position
    FROM "work_original_publishers"
) AS ordered
WHERE link.work_id = ordered.work_id
AND link.publisher_id = ordered.publisher_id;

UPDATE "work_serialization_magazines" AS link
SET "position" = ordered.position
FROM (
    SELECT
        work_id,
        magazine_id,
        ROW_NUMBER() OVER (PARTITION BY work_id ORDER BY magazine_id) - 1 AS position
    FROM "work_serialization_magazines"
) AS ordered
WHERE link.work_id = ordered.work_id
AND link.magazine_id = ordered.magazine_id;

CREATE INDEX "idx_work_original_publishers_position"
ON "work_original_publishers"("work_id", "position");

CREATE INDEX "idx_work_serialization_magazines_position"
ON "work_serialization_magazines"("work_id", "position");
