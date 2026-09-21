const { setTimeout: delay } = require('node:timers/promises');
const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');
const auth = require('../src/modules/auth');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const testEmailDomain = 'perfis-test.local';
const validPassword = 'SenhaForte123!';

let suspendedForeignAdmins = [];

function makeUser(overrides = {}) {
    const suffix = overrides.suffix || Math.random().toString(16).slice(2, 8);

    return {
        username: `perfis_${runId}_${suffix}`.slice(0, 50),
        email: `perfis_${runId}_${suffix}@${testEmailDomain}`,
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
         RETURNING id, username, email, status, nivel_acesso, preferred_profile_id`,
        [user.username, user.email, passwordHash, user.status, user.nivelAcesso]
    );

    return result.rows[0];
}

async function login(user) {
    const response = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password });

    const cookies = response.headers['set-cookie'] || [];
    return { response, cookie: cookies.find((cookie) => cookie.startsWith('comanga_session=')) };
}

async function listProfileCodes(userId) {
    const result = await db.query(
        `SELECT p.code FROM user_profiles up
         JOIN profiles p ON p.id = up.profile_id
         WHERE up.user_id = $1
         ORDER BY p.code`,
        [userId]
    );

    return result.rows.map((row) => row.code);
}

async function deleteTestUsers() {
    await db.query(
        'DELETE FROM users WHERE email LIKE $1 OR username LIKE $2',
        [`%@${testEmailDomain}`, `perfis_${runId}_%`]
    );
}

// A proteção do último administrador é global; a suíte isola os administradores alheios e os devolve ao fim.
async function suspendForeignAdmins() {
    const result = await db.query(
        `SELECT u.id FROM users u
         JOIN user_profiles up ON up.user_id = u.id
         JOIN profiles p ON p.id = up.profile_id
         WHERE p.code = 'ADMINISTRADOR' AND u.status = 'Ativada' AND u.email NOT LIKE $1`,
        [`%@${testEmailDomain}`]
    );
    suspendedForeignAdmins = result.rows.map((row) => row.id);
    if (suspendedForeignAdmins.length > 0) {
        await db.query("UPDATE users SET nivel_acesso = 'Usuário Padrão' WHERE id = ANY($1::uuid[])", [suspendedForeignAdmins]);
    }
}

async function restoreForeignAdmins() {
    if (suspendedForeignAdmins.length === 0) return;
    await db.query("UPDATE users SET nivel_acesso = 'Administrador' WHERE id = ANY($1::uuid[])", [suspendedForeignAdmins]);
    suspendedForeignAdmins = [];
}

describe('perfis de acesso como entidades', () => {
    beforeAll(async () => {
        await deleteTestUsers();
        await suspendForeignAdmins();
    });

    afterAll(async () => {
        await deleteTestUsers();
        await restoreForeignAdmins();
    });

    afterEach(async () => {
        await deleteTestUsers();
    });

    it('semeia os perfis do sistema com identidade estável e nomes oficiais', async () => {
        const result = await db.query('SELECT code, name, is_system FROM profiles ORDER BY code');

        expect(result.rows).toEqual([
            { code: 'ADMINISTRADOR', name: 'Administrador', is_system: true },
            { code: 'USUARIO_PADRAO', name: 'Usuário Padrão', is_system: true }
        ]);
    });

    it('impede duplicidade da mesma combinação de usuário e perfil', async () => {
        const user = await insertUser(makeUser({ suffix: 'unico' }));
        const profile = await db.query("SELECT id FROM profiles WHERE code = 'USUARIO_PADRAO'");

        await expect(db.query(
            'INSERT INTO user_profiles (user_id, profile_id) VALUES ($1, $2)',
            [user.id, profile.rows[0].id]
        )).rejects.toMatchObject({ code: '23505' });
    });

    it('impede a exclusão de um perfil do sistema em uso', async () => {
        await insertUser(makeUser({ suffix: 'restrito' }));

        await expect(db.query("DELETE FROM profiles WHERE code = 'USUARIO_PADRAO'"))
            .rejects.toMatchObject({ code: '23503' });
    });

    it('toda conta nasce com o perfil Usuário Padrão e sem poderes administrativos', async () => {
        const user = makeUser({ suffix: 'comum' });
        const inserted = await insertUser(user);
        const { response, cookie } = await login(user);

        expect(await listProfileCodes(inserted.id)).toEqual(['USUARIO_PADRAO']);
        expect(response.body.user.profiles).toEqual(['Usuário Padrão']);
        expect(response.body.user.active_profile).toBe('Usuário Padrão');

        const adminResponse = await request(app).get('/api/admin/users').set('Cookie', cookie);
        expect(adminResponse.status).toBe(403);
    });

    it('conta exclusivamente padrão não consegue assumir o perfil Administrador pelo corpo da requisição', async () => {
        const user = makeUser({ suffix: 'escalada' });
        await insertUser(user);
        const { cookie } = await login(user);

        const response = await request(app)
            .patch('/api/users/me/active-profile')
            .set('Cookie', cookie)
            .send({ profile: 'Administrador' });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/não possui este perfil/i);
        expect((await request(app).get('/api/admin/users').set('Cookie', cookie)).status).toBe(403);
    });

    it('recusa perfil inexistente sem alterar a sessão', async () => {
        const user = makeUser({ suffix: 'inexistente' });
        await insertUser(user);
        const { cookie } = await login(user);

        const response = await request(app)
            .patch('/api/users/me/active-profile')
            .set('Cookie', cookie)
            .send({ profile: 'Dono do Sistema' });

        expect(response.status).toBe(400);
        const profile = await request(app).get('/api/users/me').set('Cookie', cookie);
        expect(profile.body.user.active_profile).toBe('Usuário Padrão');
    });

    it('administrador alterna entre os perfis que possui e a autorização acompanha o perfil ativo', async () => {
        const admin = makeUser({ suffix: 'alterna', nivelAcesso: 'Administrador' });
        await insertUser(admin);
        const { response: loginResponse, cookie } = await login(admin);

        expect(loginResponse.body.user.profiles).toEqual(['Administrador', 'Usuário Padrão']);
        expect(loginResponse.body.user.active_profile).toBe('Administrador');
        expect((await request(app).get('/api/admin/users').set('Cookie', cookie)).status).toBe(200);

        const toStandard = await request(app)
            .patch('/api/users/me/active-profile')
            .set('Cookie', cookie)
            .send({ profile: 'Usuário Padrão' });

        expect(toStandard.status).toBe(200);
        expect(toStandard.body.user.active_profile).toBe('Usuário Padrão');
        expect(toStandard.body.user.profiles).toEqual(['Administrador', 'Usuário Padrão']);
        expect((await request(app).get('/api/admin/users').set('Cookie', cookie)).status).toBe(403);

        const backToAdmin = await request(app)
            .patch('/api/users/me/active-profile')
            .set('Cookie', cookie)
            .send({ profile: 'Administrador' });

        expect(backToAdmin.status).toBe(200);
        expect((await request(app).get('/api/admin/users').set('Cookie', cookie)).status).toBe(200);
    });

    it('trocar o perfil ativo não concede nem remove atribuições da conta', async () => {
        const admin = makeUser({ suffix: 'mantem', nivelAcesso: 'Administrador' });
        const inserted = await insertUser(admin);
        const { cookie } = await login(admin);

        await request(app)
            .patch('/api/users/me/active-profile')
            .set('Cookie', cookie)
            .send({ profile: 'Usuário Padrão' });

        expect(await listProfileCodes(inserted.id)).toEqual(['ADMINISTRADOR', 'USUARIO_PADRAO']);
    });

    it('troca em uma sessão não altera o perfil ativo de outra sessão já aberta', async () => {
        const admin = makeUser({ suffix: 'sessoes', nivelAcesso: 'Administrador' });
        await insertUser(admin);
        const first = await login(admin);
        const second = await login(admin);

        await request(app)
            .patch('/api/users/me/active-profile')
            .set('Cookie', first.cookie)
            .send({ profile: 'Usuário Padrão' });

        const firstView = await request(app).get('/api/users/me').set('Cookie', first.cookie);
        const secondView = await request(app).get('/api/users/me').set('Cookie', second.cookie);

        expect(firstView.body.user.active_profile).toBe('Usuário Padrão');
        expect(secondView.body.user.active_profile).toBe('Administrador');
        expect((await request(app).get('/api/admin/users').set('Cookie', second.cookie)).status).toBe(200);
    });

    it('novo login inicia com o último perfil preferido salvo', async () => {
        const admin = makeUser({ suffix: 'preferido', nivelAcesso: 'Administrador' });
        await insertUser(admin);
        const first = await login(admin);

        await request(app)
            .patch('/api/users/me/active-profile')
            .set('Cookie', first.cookie)
            .send({ profile: 'Usuário Padrão' });

        const second = await login(admin);
        expect(second.response.body.user.active_profile).toBe('Usuário Padrão');
        expect((await request(app).get('/api/admin/users').set('Cookie', second.cookie)).status).toBe(403);
    });

    it('sessão antiga deixa de ser autorizada quando a atribuição administrativa é removida', async () => {
        const acting = makeUser({ suffix: 'acting', nivelAcesso: 'Administrador' });
        const target = makeUser({ suffix: 'rebaixado', nivelAcesso: 'Administrador' });
        await insertUser(acting);
        const insertedTarget = await insertUser(target);
        const actingSession = await login(acting);
        const targetSession = await login(target);

        expect((await request(app).get('/api/admin/users').set('Cookie', targetSession.cookie)).status).toBe(200);

        const patch = await request(app)
            .patch(`/api/admin/users/${insertedTarget.id}/role`)
            .set('Cookie', actingSession.cookie)
            .send({ role: 'Usuário Padrão' });

        expect(patch.status).toBe(200);
        expect(patch.body.user.profiles).toEqual(['Usuário Padrão']);
        expect(await listProfileCodes(insertedTarget.id)).toEqual(['USUARIO_PADRAO']);
        expect((await request(app).get('/api/admin/users').set('Cookie', targetSession.cookie)).status).toBe(403);
    });

    it('conta não ativada não utiliza nenhum perfil', async () => {
        const admin = makeUser({ suffix: 'bloqueado', nivelAcesso: 'Administrador' });
        const inserted = await insertUser(admin);
        const { cookie } = await login(admin);

        await db.query("UPDATE users SET status = 'Bloqueada' WHERE id = $1", [inserted.id]);

        expect((await request(app).get('/api/admin/users').set('Cookie', cookie)).status).toBe(403);
        expect((await request(app).get('/api/users/me').set('Cookie', cookie)).status).toBe(403);
    });

    it('impede que a remoção concorrente de atribuições deixe o sistema sem administrador', async () => {
        const first = makeUser({ suffix: 'concorrente-a', nivelAcesso: 'Administrador' });
        const second = makeUser({ suffix: 'concorrente-b', nivelAcesso: 'Administrador' });
        const insertedFirst = await insertUser(first);
        const insertedSecond = await insertUser(second);
        const firstSession = await login(first);
        const secondSession = await login(second);

        const [firstResult, secondResult] = await Promise.all([
            request(app)
                .patch(`/api/admin/users/${insertedSecond.id}/role`)
                .set('Cookie', firstSession.cookie)
                .send({ role: 'Usuário Padrão' }),
            request(app)
                .patch(`/api/admin/users/${insertedFirst.id}/role`)
                .set('Cookie', secondSession.cookie)
                .send({ role: 'Usuário Padrão' })
        ]);

        const statuses = [firstResult.status, secondResult.status];
        expect(statuses).toContain(200);
        // A perdedora é recusada pela proteção do último administrador (409)
        // ou pela autorização, se a atribuição dela já tiver sido removida (403).
        const loser = statuses.find((status) => status !== 200);
        expect([403, 409]).toContain(loser);

        const remaining = await db.query(
            `SELECT COUNT(*)::int AS total FROM users u
             JOIN user_profiles up ON up.user_id = u.id
             JOIN profiles p ON p.id = up.profile_id
             WHERE p.code = 'ADMINISTRADOR' AND u.status = 'Ativada'`
        );
        expect(remaining.rows[0].total).toBe(1);
    });

    it('impede que o último administrador exclua a própria conta', async () => {
        const admin = makeUser({ suffix: 'ultimo', nivelAcesso: 'Administrador' });
        const inserted = await insertUser(admin);
        const { cookie } = await login(admin);

        const response = await request(app)
            .delete('/api/users/me')
            .set('Cookie', cookie)
            .send({ currentPassword: validPassword });

        expect(response.status).toBe(409);
        const stillThere = await db.query('SELECT id FROM users WHERE id = $1', [inserted.id]);
        expect(stillThere.rows).toHaveLength(1);
    });

    it('permite excluir a própria conta administrativa quando outro administrador permanece', async () => {
        const remaining = makeUser({ suffix: 'remanescente', nivelAcesso: 'Administrador' });
        const leaving = makeUser({ suffix: 'saindo', nivelAcesso: 'Administrador' });
        await insertUser(remaining);
        const insertedLeaving = await insertUser(leaving);
        const { cookie } = await login(leaving);

        const response = await request(app)
            .delete('/api/users/me')
            .set('Cookie', cookie)
            .send({ currentPassword: validPassword });

        expect(response.status).toBe(200);
        const removed = await db.query('SELECT id FROM users WHERE id = $1', [insertedLeaving.id]);
        expect(removed.rows).toHaveLength(0);
    });

    it('a concessão de atribuição administrativa sincroniza o campo legado nivel_acesso', async () => {
        const acting = makeUser({ suffix: 'concede', nivelAcesso: 'Administrador' });
        const target = makeUser({ suffix: 'promovido' });
        await insertUser(acting);
        const insertedTarget = await insertUser(target);
        const actingSession = await login(acting);

        await request(app)
            .patch(`/api/admin/users/${insertedTarget.id}/role`)
            .set('Cookie', actingSession.cookie)
            .send({ role: 'Administrador' });

        const legacy = await db.query('SELECT nivel_acesso FROM users WHERE id = $1', [insertedTarget.id]);
        expect(legacy.rows[0].nivel_acesso).toBe('Administrador');
        expect(await listProfileCodes(insertedTarget.id)).toEqual(['ADMINISTRADOR', 'USUARIO_PADRAO']);
    });
    it('serializa remoções antes de bloquear usuários distintos, sem deadlock', async () => {
        const first = makeUser({ suffix: 'ordem-a', nivelAcesso: 'Administrador' });
        const second = makeUser({ suffix: 'ordem-b', nivelAcesso: 'Administrador' });
        const a = await insertUser(first);
        const b = await insertUser(second);
        const sessionA = await login(first);
        const sessionB = await login(second);
        let releaseFirst;
        let notifyLocked;
        const gate = new Promise(resolve => { releaseFirst = resolve; });
        const locked = new Promise(resolve => { notifyLocked = resolve; });
        const original = auth.lockUserRow;
        const spy = jest.spyOn(auth, 'lockUserRow').mockImplementation(async (tx, id) => {
            await original(tx, id);
            if (id === b.id) { notifyLocked(); await gate; }
        });
        const firstRequest = request(app).patch(`/api/admin/users/${b.id}/role`)
            .set('Cookie', sessionA.cookie).send({ role: 'Usuário Padrão' }).then(result => result);
        await locked;
        const secondRequest = request(app).patch(`/api/admin/users/${a.id}/role`)
            .set('Cookie', sessionB.cookie).send({ role: 'Usuário Padrão' }).then(result => result);
        try {
            await waitForBlockedProfileChange();
        } finally {
            releaseFirst();
        }
        const responses = await Promise.all([firstRequest, secondRequest]);
        spy.mockRestore();
        expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
        expect(await listProfileCodes(a.id)).toContain('ADMINISTRADOR');
        expect(await listProfileCodes(b.id)).not.toContain('ADMINISTRADOR');
    });

});


async function waitForBlockedProfileChange() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const waiting = await db.query(`SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND pid <> pg_backend_pid()`);
        if (waiting.rowCount > 0) return;
        await delay(10);
    }
    throw new Error('A alteração concorrente não chegou ao bloqueio esperado.');
}
