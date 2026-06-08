const db = require('../src/database');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'schema-test.local';

function makeUser(overrides = {}) {
    return {
        username: `schema_${runId}`.slice(0, 20),
        email: `schema_${runId}@${testEmailDomain}`,
        passwordHash: 'hash_de_teste',
        activationToken: `token_${runId}`.slice(0, 64),
        activationExpiresAt: new Date(Date.now() + 3600000),
        ...overrides
    };
}

async function insertUser(user) {
    return db.query(
        `INSERT INTO users (username, email, password_hash, activation_token, activation_expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING username, email, status, nivel_acesso, conteudo_adulto`,
        [user.username, user.email, user.passwordHash, user.activationToken, user.activationExpiresAt]
    );
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, 'schema_%']
    );
}

describe('schema users', () => {
    beforeEach(async () => {
        await deleteTestUsers();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('aplica defaults de cadastro no banco', async () => {
        const result = await insertUser(makeUser());

        expect(result.rows[0]).toMatchObject({
            status: 'Pendente',
            nivel_acesso: 'Usuário Padrão',
            conteudo_adulto: false
        });
    });

    it('rejeita duplicidade de e-mail por UNIQUE no banco', async () => {
        const user = makeUser();
        await insertUser(user);

        await expect(insertUser(makeUser({
            username: `schema2_${runId}`.slice(0, 20),
            email: user.email,
            activationToken: `token2_${runId}`.slice(0, 64)
        }))).rejects.toMatchObject({ code: '23505' });
    });

    it('rejeita duplicidade de username por UNIQUE no banco', async () => {
        const user = makeUser();
        await insertUser(user);

        await expect(insertUser(makeUser({
            username: user.username,
            email: `schema2_${runId}@${testEmailDomain}`,
            activationToken: `token2_${runId}`.slice(0, 64)
        }))).rejects.toMatchObject({ code: '23505' });
    });
});
