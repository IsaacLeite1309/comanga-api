exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            status VARCHAR(20) DEFAULT 'Pendente',
            nivel_acesso VARCHAR(50) DEFAULT 'Usuário Padrão',
            activation_token VARCHAR(255),
            activation_expires_at TIMESTAMP WITH TIME ZONE,
            conteudo_adulto BOOLEAN DEFAULT false,
            criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
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
    pgm.sql(`DROP TABLE IF EXISTS users CASCADE;`);
};
