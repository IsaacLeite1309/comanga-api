ALTER TABLE users
    ADD COLUMN terms_version VARCHAR(50),
    ADD COLUMN terms_accepted_at TIMESTAMPTZ,
    ADD CONSTRAINT users_terms_acceptance_pair_check
        CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));
