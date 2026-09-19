ALTER TABLE works
    ADD COLUMN IF NOT EXISTS slug VARCHAR(255);

DO $$
DECLARE
    work_record RECORD;
    base_slug TEXT;
    candidate_slug TEXT;
    collision_number INTEGER;
BEGIN
    FOR work_record IN
        SELECT id, title
        FROM works
        WHERE slug IS NULL OR BTRIM(slug) = ''
        ORDER BY id
    LOOP
        base_slug := LOWER(work_record.title);
        base_slug := TRANSLATE(
            base_slug,
            'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
            'aaaaaaeeeeiiiiooooouuuucnyy'
        );
        base_slug := REGEXP_REPLACE(base_slug, '[^a-z0-9]+', '-', 'g');
        base_slug := REGEXP_REPLACE(base_slug, '(^-+|-+$)', '', 'g');
        base_slug := LEFT(base_slug, 240);
        base_slug := REGEXP_REPLACE(base_slug, '-+$', '', 'g');

        IF base_slug = '' THEN
            base_slug := 'obra';
        END IF;

        candidate_slug := base_slug;
        collision_number := 2;

        WHILE EXISTS (
            SELECT 1
            FROM works
            WHERE slug = candidate_slug
              AND id <> work_record.id
        ) LOOP
            candidate_slug := LEFT(base_slug, 255 - LENGTH(collision_number::TEXT) - 1)
                || '-'
                || collision_number::TEXT;
            collision_number := collision_number + 1;
        END LOOP;

        UPDATE works
        SET slug = candidate_slug
        WHERE id = work_record.id;
    END LOOP;
END $$;

ALTER TABLE works
    ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS works_slug_key
    ON works (slug);
