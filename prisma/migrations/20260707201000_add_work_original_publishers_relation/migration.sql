CREATE TABLE IF NOT EXISTS work_original_publishers (
    work_id INTEGER NOT NULL,
    publisher_id INTEGER NOT NULL,
    CONSTRAINT work_original_publishers_pkey PRIMARY KEY (work_id, publisher_id),
    CONSTRAINT work_original_publishers_work_id_fkey
        FOREIGN KEY (work_id)
        REFERENCES works(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT work_original_publishers_publisher_id_fkey
        FOREIGN KEY (publisher_id)
        REFERENCES domain_option_values(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_original_publishers_publisher
    ON work_original_publishers(publisher_id);

INSERT INTO work_original_publishers (work_id, publisher_id)
SELECT id, original_publisher_id
FROM works
WHERE original_publisher_id IS NOT NULL
ON CONFLICT DO NOTHING;
