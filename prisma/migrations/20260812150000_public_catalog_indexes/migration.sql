-- Busca parcial por identidade da Obra. O rotulo indexado atende autores e
-- permanece reutilizavel pelas demais opcoes de dominio.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_works_title_trgm
    ON works USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_works_original_title_trgm
    ON works USING GIN (original_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_domain_option_values_label_trgm
    ON domain_option_values USING GIN (label gin_trgm_ops);

-- Visibilidade, classificacao e ordenacao da vitrine de Obras.
CREATE INDEX IF NOT EXISTS idx_works_public_filters
    ON works (visibility, adult_content, type_id, country, id);

CREATE INDEX IF NOT EXISTS idx_works_visibility_title
    ON works (visibility, title, id);

-- Os indices invertidos dos vinculos permitem intersectar varios valores do
-- mesmo filtro antes de voltar para a Obra.
CREATE INDEX IF NOT EXISTS idx_work_authors_author_work
    ON work_authors (author_id, work_id);

CREATE INDEX IF NOT EXISTS idx_work_genres_genre_work
    ON work_genres (genre_id, work_id);

CREATE INDEX IF NOT EXISTS idx_work_demographies_demography_work
    ON work_demographies (demography, work_id);

-- Filtros editoriais. O indice de editora brasileira tambem atende o recorte
-- por editora do calendario, sem manter uma estrutura fisica redundante.
CREATE INDEX IF NOT EXISTS idx_editions_visibility_publisher
    ON editions (visibility, brazilian_publisher_id, id);

CREATE INDEX IF NOT EXISTS idx_editions_visibility_format
    ON editions (visibility, format_id, id);

CREATE INDEX IF NOT EXISTS idx_editions_visibility_cover_type
    ON editions (visibility, cover_type_id, id);

-- A data de publicacao e armazenada com precisao variavel em tres colunas.
-- edition_id ao final cobre o vinculo usado pelo calendario.
CREATE INDEX IF NOT EXISTS idx_volumes_calendar_release
    ON volumes (
        visibility,
        release_year,
        release_month,
        release_day,
        id,
        edition_id
    );
