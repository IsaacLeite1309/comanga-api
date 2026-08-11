ALTER TABLE editions
    ADD COLUMN brazil_publication_status VARCHAR(30);

UPDATE editions
SET brazil_publication_status = domain_option_values.label
FROM domain_option_values
WHERE editions.brazil_publication_status_id = domain_option_values.id;

ALTER TABLE editions
    ALTER COLUMN brazil_publication_status SET NOT NULL;

ALTER TABLE editions
    DROP CONSTRAINT IF EXISTS editions_brazil_publication_status_id_fkey;

ALTER TABLE editions
    DROP COLUMN brazil_publication_status_id;
