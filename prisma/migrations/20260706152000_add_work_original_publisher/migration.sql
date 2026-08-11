ALTER TABLE works
    ADD COLUMN IF NOT EXISTS original_publisher_id INTEGER;

ALTER TABLE works
    ADD CONSTRAINT works_original_publisher_id_fkey
    FOREIGN KEY (original_publisher_id)
    REFERENCES domain_option_values(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_works_original_publisher
    ON works(original_publisher_id);
