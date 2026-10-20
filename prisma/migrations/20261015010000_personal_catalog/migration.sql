CREATE TABLE user_volumes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    state VARCHAR(10) NOT NULL,
    read BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, volume_id),
    CONSTRAINT user_volumes_state_read_check CHECK (
        (state = 'Owned' AND read IS NOT NULL) OR (state = 'Wanted' AND read IS NULL)
    )
);
CREATE INDEX idx_user_volumes_user_state ON user_volumes(user_id, state, volume_id);
CREATE INDEX idx_user_volumes_volume ON user_volumes(volume_id);
