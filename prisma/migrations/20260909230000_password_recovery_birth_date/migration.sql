-- Existing accounts are preserved; unknown age cannot enable adult content.
ALTER TABLE users ADD COLUMN birth_date DATE;
ALTER TABLE users ADD CONSTRAINT users_birth_date_valid CHECK (birth_date IS NULL OR (birth_date >= DATE '0001-01-01' AND birth_date <= CURRENT_DATE));
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMPTZ
);
CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
