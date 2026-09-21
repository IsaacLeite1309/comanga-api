ALTER TABLE work_author_roles
    DROP CONSTRAINT IF EXISTS work_author_roles_role_check;

ALTER TABLE work_author_roles
    ADD CONSTRAINT work_author_roles_role_check
    CHECK (role IN (
        'História e Arte',
        'História',
        'Arte',
        'Criador Original',
        'História Original',
        'Ilustrador',
        'Design de Personagens'
    ));
