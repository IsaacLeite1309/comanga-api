DELETE FROM work_demographies AS demography
WHERE EXISTS (
    SELECT 1
    FROM work_genres AS link
    JOIN domain_option_values AS genre ON genre.id = link.genre_id
    JOIN domain_option_categories AS category ON category.id = genre.category_id
    WHERE link.work_id = demography.work_id
      AND category.slug = 'generos'
      AND genre.code IN ('boys-love', 'girls-love')
);
