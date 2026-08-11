UPDATE volumes
SET visibility = 'Público'
WHERE visibility IN ('PÃºblico', 'PÃƒÂºblico');

ALTER TABLE volumes
    DROP CONSTRAINT IF EXISTS volumes_visibility_check;

ALTER TABLE volumes
    ADD CONSTRAINT volumes_visibility_check
    CHECK (visibility IN ('Privado', 'Público'));
