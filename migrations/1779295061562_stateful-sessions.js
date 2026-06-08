exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS activation_token VARCHAR(255),
            ADD COLUMN IF NOT EXISTS activation_expires_at TIMESTAMP WITH TIME ZONE;
    `);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS sessions (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            session_token_hash VARCHAR(64) UNIQUE NOT NULL,
            last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            revoked_at TIMESTAMP WITH TIME ZONE,
            criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    pgm.sql(`
        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(session_token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id) WHERE revoked_at IS NULL;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS sessions CASCADE;`);
    pgm.sql(`
        ALTER TABLE users
            DROP COLUMN IF EXISTS activation_token,
            DROP COLUMN IF EXISTS activation_expires_at;
    `);
};
