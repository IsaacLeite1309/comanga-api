-- Perfis de acesso viram entidades proprias; nivel_acesso continua existindo
-- como coluna legada sincronizada ate a migration futura que a remover.

CREATE TABLE profiles (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(50) NOT NULL UNIQUE,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Semeadura idempotente dos perfis controlados pelo sistema.
INSERT INTO profiles (code, name, is_system)
VALUES ('USUARIO_PADRAO', 'Usuário Padrão', TRUE),
       ('ADMINISTRADOR', 'Administrador', TRUE)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE user_profiles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id, profile_id)
);

CREATE INDEX idx_user_profiles_profile ON user_profiles(profile_id);

ALTER TABLE users ADD COLUMN preferred_profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN active_profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL;

-- Backfill: toda conta existente passa a possuir o perfil padrao.
INSERT INTO user_profiles (user_id, profile_id)
SELECT users.id, profiles.id
FROM users
CROSS JOIN profiles
WHERE profiles.code = 'USUARIO_PADRAO'
ON CONFLICT DO NOTHING;

-- Backfill: contas administrativas acumulam tambem o perfil Administrador.
INSERT INTO user_profiles (user_id, profile_id)
SELECT users.id, profiles.id
FROM users
CROSS JOIN profiles
WHERE profiles.code = 'ADMINISTRADOR'
  AND users.nivel_acesso = 'Administrador'
ON CONFLICT DO NOTHING;

-- Preferencia salva na conta: administradores entram como Administrador.
UPDATE users
SET preferred_profile_id = profiles.id
FROM profiles
WHERE users.preferred_profile_id IS NULL
  AND profiles.code = CASE
      WHEN users.nivel_acesso = 'Administrador' THEN 'ADMINISTRADOR'
      ELSE 'USUARIO_PADRAO'
  END;

-- Sessoes ja abertas recebem perfil ativo sem serem revogadas.
UPDATE sessions
SET active_profile_id = users.preferred_profile_id
FROM users
WHERE sessions.user_id = users.id
  AND sessions.active_profile_id IS NULL;

-- Ponte de compatibilidade: qualquer escrita que ainda use nivel_acesso
-- (codigo legado, scripts e fixtures) mantem as atribuicoes coerentes.
CREATE OR REPLACE FUNCTION sincroniza_perfis_por_nivel_acesso() RETURNS TRIGGER AS $$
DECLARE
    perfil_padrao INTEGER;
    perfil_admin INTEGER;
BEGIN
    SELECT id INTO perfil_padrao FROM profiles WHERE code = 'USUARIO_PADRAO';
    SELECT id INTO perfil_admin FROM profiles WHERE code = 'ADMINISTRADOR';

    INSERT INTO user_profiles (user_id, profile_id)
    VALUES (NEW.id, perfil_padrao)
    ON CONFLICT DO NOTHING;

    IF NEW.nivel_acesso = 'Administrador' THEN
        INSERT INTO user_profiles (user_id, profile_id)
        VALUES (NEW.id, perfil_admin)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM user_profiles WHERE user_id = NEW.id AND profile_id = perfil_admin;
    END IF;

    -- Na inclusão a preferência nasce do nível; na mudança de nível ela acompanha a concessão.
    IF TG_OP = 'INSERT' THEN
        UPDATE users
        SET preferred_profile_id = CASE WHEN NEW.nivel_acesso = 'Administrador' THEN perfil_admin ELSE perfil_padrao END
        WHERE id = NEW.id AND preferred_profile_id IS NULL;
    ELSE
        UPDATE users
        SET preferred_profile_id = CASE WHEN NEW.nivel_acesso = 'Administrador' THEN perfil_admin ELSE perfil_padrao END
        WHERE id = NEW.id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_sincroniza_perfis_insert
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION sincroniza_perfis_por_nivel_acesso();

CREATE TRIGGER users_sincroniza_perfis_update
AFTER UPDATE OF nivel_acesso ON users
FOR EACH ROW
WHEN (OLD.nivel_acesso IS DISTINCT FROM NEW.nivel_acesso)
EXECUTE FUNCTION sincroniza_perfis_por_nivel_acesso();
