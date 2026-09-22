-- Preserva IDs, rótulos, ativação e vínculos dos aliases que o seed deixou como legados.
-- O marcador é interno: não torna o alias oficial nem permite novas associações.
ALTER TABLE domain_option_values
    ADD COLUMN IF NOT EXISTS adult_only BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE domain_option_values AS value
SET adult_only = TRUE
FROM domain_option_categories AS category
WHERE category.id = value.category_id
  AND category.slug = 'generos'
  AND (value.code = 'hentai' OR lower(btrim(translate(
      value.label,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç’''`´',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
  ))) = 'hentai');

UPDATE works
SET adult_content = TRUE
WHERE adult_content = FALSE
  AND EXISTS (
      SELECT 1 FROM work_genres AS link
      JOIN domain_option_values AS genre ON genre.id = link.genre_id
      JOIN domain_option_categories AS category ON category.id = genre.category_id
      WHERE link.work_id = works.id AND category.slug = 'generos'
        AND (genre.adult_only OR genre.code = 'hentai')
  );
