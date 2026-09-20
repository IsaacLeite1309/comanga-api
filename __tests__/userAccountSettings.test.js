const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');
const { defaultPasswordChangeLimiter } = require('../src/modules/auth/passwordChangeRateLimiter');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'conta-test.local';
const validPassword = 'SenhaForte123!';
const newPassword = 'OutraSenha456@';
const invalidSessionMessage = 'Sua sessão é inválida ou foi encerrada. Por favor, faça login novamente.';

function makeUser(overrides = {}) {
    const suffix = overrides.suffix || Math.random().toString(16).slice(2, 8);

    return {
        username: `conta_${runId}_${suffix}`.slice(0, 50),
        email: `conta_${runId}_${suffix}@${testEmailDomain}`,
        password: validPassword,
        status: 'Ativada',
        nivelAcesso: 'Usuário Padrão',
        ...overrides
    };
}

async function insertUser(user) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    const result = await db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, birth_date)
         VALUES ($1, $2, $3, $4, $5, '2000-01-01')
         RETURNING id, username, email`,
        [user.username, user.email, passwordHash, user.status, user.nivelAcesso]
    );

    return result.rows[0];
}

async function login(user, password = validPassword) {
    const response = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password });

    const cookies = response.headers['set-cookie'] || [];
    return { response, cookie: cookies.find((cookie) => cookie.startsWith('comanga_session=')) };
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, `conta_${runId}_%`]
    );
}

describe('PATCH /api/users/me/username', () => {
    beforeEach(deleteTestUsers);
    afterEach(deleteTestUsers);

    it('altera o próprio nome de usuário e devolve o perfil atualizado', async () => {
        const user = makeUser({ suffix: 'nome' });
        const inserted = await insertUser(user);
        const { cookie } = await login(user);
        const novoNome = `renomeado_${runId}`.slice(0, 20);

        const response = await request(app)
            .patch('/api/users/me/username')
            .set('Cookie', cookie)
            .send({ username: novoNome });

        expect(response.status).toBe(200);
        expect(response.body.user).toEqual(expect.objectContaining({
            username: novoNome,
            email: user.email,
            profiles: ['Usuário Padrão'],
            active_profile: 'Usuário Padrão'
        }));

        const persisted = await db.query('SELECT username FROM users WHERE id = $1', [inserted.id]);
        expect(persisted.rows[0].username).toBe(novoNome);
    });

    it('preserva maiúsculas e não aplica trim automático, como no cadastro', async () => {
        const user = makeUser({ suffix: 'caixa' });
        await insertUser(user);
        const { cookie } = await login(user);
        const novoNome = `Nome_MISTO_${runId}`.slice(0, 20);

        const response = await request(app)
            .patch('/api/users/me/username')
            .set('Cookie', cookie)
            .send({ username: novoNome });

        expect(response.status).toBe(200);
        expect(response.body.user.username).toBe(novoNome);

        const comEspacos = await request(app)
            .patch('/api/users/me/username')
            .set('Cookie', cookie)
            .send({ username: ` ${novoNome} ` });

        expect(comEspacos.status).toBe(400);
    });

    it.each([
        ['vazio', ''],
        ['curto demais', 'ab'],
        ['longo demais', 'a'.repeat(21)],
        ['com acento', 'usuário_teste'],
        ['com espaço', 'usuario teste'],
        ['com símbolo', 'usuario!']
    ])('recusa nome %s sem alterar o valor atual', async (_caso, invalido) => {
        const user = makeUser({ suffix: 'invalido' });
        const inserted = await insertUser(user);
        const { cookie } = await login(user);

        const response = await request(app)
            .patch('/api/users/me/username')
            .set('Cookie', cookie)
            .send({ username: invalido });

        expect(response.status).toBe(400);
        expect(response.body.field).toBe('username');
        const persisted = await db.query('SELECT username FROM users WHERE id = $1', [inserted.id]);
        expect(persisted.rows[0].username).toBe(user.username);
    });

    it('recusa nome já utilizado por outra conta com 409 e mantém o valor atual', async () => {
        const owner = makeUser({ suffix: 'dono', username: `dono_${runId}`.slice(0, 20) });
        const user = makeUser({ suffix: 'tentativa' });
        await insertUser(owner);
        const inserted = await insertUser(user);
        const { cookie } = await login(user);

        const response = await request(app)
            .patch('/api/users/me/username')
            .set('Cookie', cookie)
            .send({ username: owner.username });

        expect(response.status).toBe(409);
        expect(response.body.field).toBe('username');
        const persisted = await db.query('SELECT username FROM users WHERE id = $1', [inserted.id]);
        expect(persisted.rows[0].username).toBe(user.username);
    });

    it('exige sessão válida e ignora qualquer identificação vinda do corpo', async () => {
        const victim = makeUser({ suffix: 'vitima' });
        const attacker = makeUser({ suffix: 'atacante' });
        const insertedVictim = await insertUser(victim);
        await insertUser(attacker);
        const { cookie } = await login(attacker);

        const semSessao = await request(app)
            .patch('/api/users/me/username')
            .send({ username: `sem_sessao_${runId}`.slice(0, 20) });
        expect(semSessao.status).toBe(401);
        expect(semSessao.body).toEqual({ error: invalidSessionMessage });

        const comAlvoForjado = await request(app)
            .patch('/api/users/me/username')
            .set('Cookie', cookie)
            .send({ username: `forjado_${runId}`.slice(0, 20), userId: insertedVictim.id, id: insertedVictim.id });

        expect(comAlvoForjado.status).toBe(200);
        const victimRow = await db.query('SELECT username FROM users WHERE id = $1', [insertedVictim.id]);
        expect(victimRow.rows[0].username).toBe(victim.username);
    });

    it('recusa sessão revogada', async () => {
        const user = makeUser({ suffix: 'revogada' });
        await insertUser(user);
        const { cookie } = await login(user);
        await db.query('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP');

        const response = await request(app)
            .patch('/api/users/me/username')
            .set('Cookie', cookie)
            .send({ username: `revogado_${runId}`.slice(0, 20) });

        expect(response.status).toBe(401);
    });
});

describe('PATCH /api/users/me/password', () => {
    beforeEach(async () => {
        defaultPasswordChangeLimiter.reset();
        await deleteTestUsers();
    });

    afterEach(async () => {
        defaultPasswordChangeLimiter.reset();
        await deleteTestUsers();
    });

    it('troca a senha, mantém a sessão atual e revoga as demais', async () => {
        const user = makeUser({ suffix: 'troca' });
        const inserted = await insertUser(user);
        const current = await login(user);
        const other = await login(user);

        const response = await request(app)
            .patch('/api/users/me/password')
            .set('Cookie', current.cookie)
            .send({ currentPassword: validPassword, newPassword, confirmPassword: newPassword });

        expect(response.status).toBe(200);
        expect(JSON.stringify(response.body)).not.toContain(newPassword);

        expect((await request(app).get('/api/users/me').set('Cookie', current.cookie)).status).toBe(200);
        expect((await request(app).get('/api/users/me').set('Cookie', other.cookie)).status).toBe(401);

        const stored = await db.query('SELECT password_hash FROM users WHERE id = $1', [inserted.id]);
        expect(stored.rows[0].password_hash).not.toBe(newPassword);
        expect(await bcrypt.compare(newPassword, stored.rows[0].password_hash)).toBe(true);

        const revoked = await db.query(
            'SELECT COUNT(*)::int AS total FROM sessions WHERE user_id = $1 AND revoked_at IS NOT NULL',
            [inserted.id]
        );
        expect(revoked.rows[0].total).toBe(1);
    });

    it('autentica com a nova senha e recusa a antiga no login seguinte', async () => {
        const user = makeUser({ suffix: 'relogin' });
        await insertUser(user);
        const current = await login(user);

        await request(app)
            .patch('/api/users/me/password')
            .set('Cookie', current.cookie)
            .send({ currentPassword: validPassword, newPassword, confirmPassword: newPassword });

        expect((await login(user, newPassword)).response.status).toBe(200);
        expect((await login(user, validPassword)).response.status).toBe(401);
    });

    it('recusa senha atual incorreta sem alterar o hash', async () => {
        const user = makeUser({ suffix: 'atual-errada' });
        const inserted = await insertUser(user);
        const { cookie } = await login(user);
        const before = await db.query('SELECT password_hash FROM users WHERE id = $1', [inserted.id]);

        const response = await request(app)
            .patch('/api/users/me/password')
            .set('Cookie', cookie)
            .send({ currentPassword: 'SenhaErrada123!', newPassword, confirmPassword: newPassword });

        expect(response.status).toBe(401);
        const after = await db.query('SELECT password_hash FROM users WHERE id = $1', [inserted.id]);
        expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash);
    });

    it('recusa confirmação divergente', async () => {
        const user = makeUser({ suffix: 'confirmacao' });
        await insertUser(user);
        const { cookie } = await login(user);

        const response = await request(app)
            .patch('/api/users/me/password')
            .set('Cookie', cookie)
            .send({ currentPassword: validPassword, newPassword, confirmPassword: 'OutraCoisa789@' });

        expect(response.status).toBe(400);
        expect(response.body.field).toBe('confirmPassword');
    });

    it('recusa nova senha fora da política vigente', async () => {
        const user = makeUser({ suffix: 'fraca' });
        await insertUser(user);
        const { cookie } = await login(user);

        const response = await request(app)
            .patch('/api/users/me/password')
            .set('Cookie', cookie)
            .send({ currentPassword: validPassword, newPassword: 'senhafraca', confirmPassword: 'senhafraca' });

        expect(response.status).toBe(400);
        expect(response.body.field).toBe('newPassword');
    });

    it('recusa nova senha igual à atual', async () => {
        const user = makeUser({ suffix: 'igual' });
        await insertUser(user);
        const { cookie } = await login(user);

        const response = await request(app)
            .patch('/api/users/me/password')
            .set('Cookie', cookie)
            .send({ currentPassword: validPassword, newPassword: validPassword, confirmPassword: validPassword });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/diferente da senha atual/i);
    });

    it('bloqueia tentativas repetidas com a senha atual incorreta', async () => {
        const user = makeUser({ suffix: 'limitador' });
        await insertUser(user);
        const { cookie } = await login(user);

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const failure = await request(app)
                .patch('/api/users/me/password')
                .set('Cookie', cookie)
                .send({ currentPassword: 'SenhaErrada123!', newPassword, confirmPassword: newPassword });
            expect(failure.status).toBe(401);
        }

        const blocked = await request(app)
            .patch('/api/users/me/password')
            .set('Cookie', cookie)
            .send({ currentPassword: validPassword, newPassword, confirmPassword: newPassword });

        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('PASSWORD_CHANGE_RATE_LIMITED');
    });

    it('exige sessão válida', async () => {
        const response = await request(app)
            .patch('/api/users/me/password')
            .send({ currentPassword: validPassword, newPassword, confirmPassword: newPassword });

        expect(response.status).toBe(401);
    });

    it('não deixa sessão criada com a senha antiga válida após a troca concorrente', async () => {
        const user = makeUser({ suffix: 'concorrencia' });
        const inserted = await insertUser(user);
        const current = await login(user);

        const [changeResult, concurrentLogin] = await Promise.all([
            request(app)
                .patch('/api/users/me/password')
                .set('Cookie', current.cookie)
                .send({ currentPassword: validPassword, newPassword, confirmPassword: newPassword }),
            login(user)
        ]);

        expect(changeResult.status).toBe(200);

        const activeSessions = await db.query(
            'SELECT COUNT(*)::int AS total FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
            [inserted.id]
        );
        expect(activeSessions.rows[0].total).toBe(1);

        if (concurrentLogin.cookie) {
            const reuse = await request(app).get('/api/users/me').set('Cookie', concurrentLogin.cookie);
            expect(reuse.status).toBe(401);
        }
        expect((await request(app).get('/api/users/me').set('Cookie', current.cookie)).status).toBe(200);
    });
});
