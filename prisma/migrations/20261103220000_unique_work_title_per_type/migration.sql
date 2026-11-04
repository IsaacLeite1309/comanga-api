DROP INDEX works_title_unique;

CREATE UNIQUE INDEX works_title_type_unique
    ON works (LOWER(title), type_id);
