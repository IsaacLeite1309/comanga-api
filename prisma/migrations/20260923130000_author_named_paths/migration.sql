DO $$
DECLARE
    author_row RECORD;
    base_slug TEXT;
    candidate TEXT;
    suffix INTEGER;
BEGIN
    FOR author_row IN
        SELECT value.id, value.label, value.category_id
        FROM domain_option_values value
        JOIN domain_option_categories category ON category.id = value.category_id
        WHERE category.slug = 'autores' AND value.code IS NULL
        ORDER BY value.id
    LOOP
        base_slug := LEFT(COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(
            LOWER(TRANSLATE(author_row.label,
                'áàâãäéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝŸ',
                'aaaaaeeeeiiiiooooouuuucnyyaaaaaeeeeiiiiooooouuuucnyy')),
            '[^[:alnum:]]+', '-', 'g')), ''), 'autor'), 70);
        candidate := base_slug;
        suffix := 2;
        WHILE EXISTS (
            SELECT 1 FROM domain_option_values
            WHERE category_id = author_row.category_id AND code = candidate
        ) LOOP
            candidate := LEFT(base_slug, 70 - LENGTH(suffix::text) - 1) || '-' || suffix::text;
            suffix := suffix + 1;
        END LOOP;
        UPDATE domain_option_values SET code = candidate WHERE id = author_row.id;
    END LOOP;
END $$;
