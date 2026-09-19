BEGIN;

UPDATE users
SET status = CASE
    WHEN status IS NULL THEN 'Pendente'
    WHEN status IN ('Ativado', 'Ativo') THEN 'Ativada'
    WHEN status IN ('Bloqueado', 'Inativa', 'Inativo') THEN 'Bloqueada'
    ELSE status
END;

UPDATE users
SET nivel_acesso = CASE
    WHEN nivel_acesso IS NULL THEN 'Usuário Padrão'
    WHEN nivel_acesso IN (
        'Usuario Padrao',
        'UsuÃ¡rio PadrÃ£o',
        'UsuÃƒÂ¡rio PadrÃƒÂ£o'
    ) THEN 'Usuário Padrão'
    ELSE nivel_acesso
END;

ALTER TABLE users
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN nivel_acesso SET NOT NULL,
    DROP CONSTRAINT IF EXISTS users_status_check,
    DROP CONSTRAINT IF EXISTS users_nivel_acesso_check,
    ADD CONSTRAINT users_status_check
        CHECK (status IN ('Pendente', 'Ativada', 'Bloqueada')),
    ADD CONSTRAINT users_nivel_acesso_check
        CHECK (nivel_acesso IN ('Administrador', 'Usuário Padrão'));

UPDATE works
SET visibility = 'Público'
WHERE visibility IN ('PÃºblico', 'PÃƒÂºblico');

UPDATE works
SET country = CASE
    WHEN country IN ('Japao', 'JapÃ£o', 'JapÃƒÂ£o') THEN 'Japão'
    WHEN country IN ('Coreia', 'CorÃ©ia do Sul', 'CorÃƒÂ©ia do Sul') THEN 'Coreia do Sul'
    ELSE country
END;

UPDATE works
SET original_publication_status = CASE
    WHEN original_publication_status IN ('Finalizada', 'Finalizado') THEN 'Completo'
    WHEN original_publication_status = 'Andamento' THEN 'Em andamento'
    WHEN original_publication_status = 'Hiato' THEN 'Em hiato'
    ELSE original_publication_status
END;

ALTER TABLE works
    DROP CONSTRAINT IF EXISTS works_visibility_check,
    DROP CONSTRAINT IF EXISTS works_country_check,
    DROP CONSTRAINT IF EXISTS works_original_publication_status_check,
    ADD CONSTRAINT works_visibility_check
        CHECK (visibility IN ('Privado', 'Público')),
    ADD CONSTRAINT works_country_check
        CHECK (country IN ('Japão', 'Coreia do Sul', 'China', 'Taiwan')),
    ADD CONSTRAINT works_original_publication_status_check
        CHECK (original_publication_status IN ('Completo', 'Em andamento', 'Em hiato', 'Cancelado'));

UPDATE work_author_roles
SET role = CASE
    WHEN role IN ('Historia e Arte', 'HistÃ³ria e Arte', 'HistÃƒÂ³ria e Arte', 'Roteiro e Arte') THEN 'História e Arte'
    WHEN role IN ('Historia', 'HistÃ³ria', 'HistÃƒÂ³ria', 'Roteiro') THEN 'História'
    WHEN role = 'Criador original' THEN 'Criador Original'
    WHEN role IN ('Historia Original', 'HistÃ³ria Original', 'HistÃƒÂ³ria Original') THEN 'História Original'
    ELSE role
END;

ALTER TABLE work_author_roles
    DROP CONSTRAINT IF EXISTS work_author_roles_role_check,
    ADD CONSTRAINT work_author_roles_role_check
        CHECK (role IN ('História e Arte', 'História', 'Arte', 'Criador Original', 'História Original', 'Ilustrador'));

UPDATE work_demographies
SET demography = CASE
    WHEN demography = 'Shounen' THEN 'Shonen'
    WHEN demography = 'Shojo' THEN 'Shoujo'
    ELSE demography
END;

ALTER TABLE work_demographies
    DROP CONSTRAINT IF EXISTS work_demographies_demography_check,
    ADD CONSTRAINT work_demographies_demography_check
        CHECK (demography IN ('Shonen', 'Shoujo', 'Seinen', 'Josei', 'Kodomo'));

UPDATE editions
SET visibility = 'Público'
WHERE visibility IN ('PÃºblico', 'PÃƒÂºblico');

UPDATE editions
SET brazil_publication_status = CASE
    WHEN brazil_publication_status IN ('Finalizada', 'Finalizado') THEN 'Completo'
    WHEN brazil_publication_status = 'Andamento' THEN 'Em andamento'
    WHEN brazil_publication_status = 'Hiato' THEN 'Em hiato'
    ELSE brazil_publication_status
END;

ALTER TABLE editions
    DROP CONSTRAINT IF EXISTS editions_visibility_check,
    DROP CONSTRAINT IF EXISTS editions_brazil_publication_status_check,
    ADD CONSTRAINT editions_visibility_check
        CHECK (visibility IN ('Privado', 'Público')),
    ADD CONSTRAINT editions_brazil_publication_status_check
        CHECK (brazil_publication_status IN ('Completo', 'Em andamento', 'Em hiato', 'Cancelado'));

UPDATE volumes
SET visibility = 'Público'
WHERE visibility IN ('PÃºblico', 'PÃƒÂºblico');

UPDATE volumes
SET release_date_precision = 'Mes e ano'
WHERE release_date_precision IN ('Mês e ano', 'MÃªs e ano', 'MÃƒÂªs e ano');

ALTER TABLE volumes
    DROP CONSTRAINT IF EXISTS volumes_visibility_check,
    DROP CONSTRAINT IF EXISTS volumes_price_currency_check,
    DROP CONSTRAINT IF EXISTS volumes_release_precision_check,
    ADD CONSTRAINT volumes_visibility_check
        CHECK (visibility IN ('Privado', 'Público')),
    ADD CONSTRAINT volumes_price_currency_check
        CHECK (price_currency IN ('R$', 'CR$', 'Cr$', 'NCz$', 'Cz$')),
    ADD CONSTRAINT volumes_release_precision_check
        CHECK (release_date_precision IN ('Completa', 'Mes e ano', 'Ano', 'Desconhecida'));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'works'
          AND column_name = 'original_publisher_id'
    ) THEN
        EXECUTE $migration$
            INSERT INTO work_original_publishers (work_id, publisher_id, position)
            SELECT
                work.id,
                work.original_publisher_id,
                COALESCE((
                    SELECT MAX(existing.position) + 1
                    FROM work_original_publishers existing
                    WHERE existing.work_id = work.id
                ), 0)
            FROM works work
            WHERE work.original_publisher_id IS NOT NULL
            ON CONFLICT (work_id, publisher_id) DO NOTHING
        $migration$;
    END IF;
END $$;

ALTER TABLE works
    DROP CONSTRAINT IF EXISTS works_original_publisher_id_fkey;

DROP INDEX IF EXISTS idx_works_original_publisher;

ALTER TABLE works
    DROP COLUMN IF EXISTS original_publisher_id;

COMMIT;
