CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE works
    ADD COLUMN search_title TEXT NOT NULL DEFAULT '',
    ADD COLUMN search_original_title TEXT,
    ADD COLUMN search_romanized_title TEXT NOT NULL DEFAULT '';

CREATE FUNCTION update_work_search_titles() RETURNS trigger AS $$
BEGIN
    NEW.search_title := lower(unaccent(NEW.title));
    NEW.search_original_title := lower(unaccent(NEW.original_title));
    NEW.search_romanized_title := lower(unaccent(NEW.romanized_title));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER works_search_titles_before_write
    BEFORE INSERT OR UPDATE OF title, original_title, romanized_title ON works
    FOR EACH ROW EXECUTE FUNCTION update_work_search_titles();

UPDATE works SET title = title;

CREATE INDEX idx_works_search_title_trgm
    ON works USING GIN (search_title gin_trgm_ops);

CREATE INDEX idx_works_search_original_title_trgm
    ON works USING GIN (search_original_title gin_trgm_ops);

CREATE INDEX idx_works_search_romanized_title_trgm
    ON works USING GIN (search_romanized_title gin_trgm_ops);
