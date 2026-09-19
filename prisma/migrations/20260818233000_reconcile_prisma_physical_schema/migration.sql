UPDATE users
SET
    conteudo_adulto = COALESCE(conteudo_adulto, FALSE),
    criado_em = COALESCE(criado_em, NOW())
WHERE conteudo_adulto IS NULL
   OR criado_em IS NULL;

ALTER TABLE users
    ALTER COLUMN conteudo_adulto SET NOT NULL,
    ALTER COLUMN criado_em SET NOT NULL;

UPDATE sessions
SET
    last_used_at = COALESCE(last_used_at, NOW()),
    criado_em = COALESCE(criado_em, NOW())
WHERE last_used_at IS NULL
   OR criado_em IS NULL;

ALTER TABLE sessions
    ALTER COLUMN last_used_at SET NOT NULL,
    ALTER COLUMN criado_em SET NOT NULL;
