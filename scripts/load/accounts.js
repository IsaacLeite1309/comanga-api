const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const bcrypt = require('bcrypt');

const pg = 'PostgreSQL';
const mail = 'Resend (envio local simulado)';
const memoryLimiter = 'limitador em memória';
const access = 'Cookie de sessão ativa';
const standard = 'Usuário Padrão';
const administrator = 'Administrador';
const missingToken = '0'.repeat(64);
const missingEmail = 'nao-cadastrado@fixture.invalid';
const termsVersion = '2026-11-18';

function route(method, path, auth, parameters = [], dependencies = [pg]) {
    return { method, path, auth, parameters, dependencies };
}

const authRoutes = {
    forgot: route('POST', '/api/auth/forgot-password', 'Público', ['email (JSON)'], [pg, mail, memoryLimiter]),
    reset: route('POST', '/api/auth/reset-password', 'Token de recuperação', ['token, password, confirmPassword (JSON)'], [pg, 'bcrypt', memoryLimiter]),
    register: route('POST', '/api/auth/register', 'Público', [
        'username, email, birthDate, password, confirmPassword (JSON)',
        'acceptedTerms, termsVersion (JSON, aceite explícito e versão dos Termos enviados pelo cliente)'
    ], [pg, 'bcrypt', mail]),
    activate: route('GET', '/api/auth/activate/:token', 'Token de ativação', ['token (caminho)']),
    resend: route('POST', '/api/auth/resend-activation', 'Público', ['email (JSON)'], [pg, mail]),
    login: route('POST', '/api/auth/login', 'Credenciais da conta', ['email, password (JSON)'], [pg, 'bcrypt', memoryLimiter]),
    logout: route('POST', '/api/auth/logout', access),
    me: route('GET', '/api/auth/me', access)
};

const userRoutes = {
    me: route('GET', '/api/users/me', access),
    adult: route('PATCH', '/api/users/me/adult-content', access, ['conteudo_adulto (JSON)']),
    profile: route('PATCH', '/api/users/me/active-profile', access, ['profile (JSON)']),
    username: route('PATCH', '/api/users/me/username', access, ['username (JSON)']),
    password: route('PATCH', '/api/users/me/password', access, ['currentPassword, newPassword, confirmPassword (JSON)'], [pg, 'bcrypt', memoryLimiter]),
    delete: route('DELETE', '/api/users/me', access, ['currentPassword (JSON)'], [pg, 'bcrypt'])
};

function scenario(endpoint, name, perform, coverageOnly = false) {
    return {
        name, endpoint: `${endpoint.method} ${endpoint.path}`, coverageOnly,
        async run(context) {
            await perform(context, input => context.request({ method: endpoint.method, path: endpoint.path, ...input }));
        }
    };
}

function simple(endpoint, name, input, coverageOnly = false) {
    return scenario(endpoint, name, (_context, request) => request(input), coverageOnly);
}

function perWorker(fixtures, options) {
    const users = new Map();
    return function userFor(workerId) {
        if (!users.has(workerId)) users.set(workerId, fixtures.createUser(options));
        return users.get(workerId);
    };
}

function uniqueUsername() {
    return `carga_${randomBytes(6).toString('hex')}`;
}

function registration(password, overrides = {}) {
    const username = uniqueUsername();
    return {
        username, email: `${username}@fixture.invalid`, birthDate: '1999-01-01', password, confirmPassword: password,
        acceptedTerms: true, termsVersion, ...overrides
    };
}

function digest(token) {
    return createHash('sha256').update(token).digest('hex');
}

async function mailboxToken(fixtures, email, kind) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const message = fixtures.mailbox.get(email);
        if (message?.kind === kind) {
            fixtures.mailbox.delete(email);
            assert.ok(/^[a-f0-9]{64}$/.test(message.token), 'Token ausente ou com formato inesperado na mensagem simulada');
            return message.token;
        }
        await delay(10);
    }
    throw new Error('E-mail simulado não foi recebido no prazo.');
}

function registerCases(fixtures) {
    return [
        scenario(authRoutes.register, 'auth.cadastro.sucesso', async ({ phase }, request) => {
            const body = registration(fixtures.password);
            const response = await request({ body, expectedStatus: 201 });
            if (response.status !== 201) return;
            assert.notEqual(response.body.email_sent, false);
            const token = await mailboxToken(fixtures, body.email, 'activation');
            if (phase === 'coverage') {
                const user = await fixtures.prisma.user.findUniqueOrThrow({ where: { email: body.email } });
                assert.equal(user.status, 'Pendente');
                assert.ok(user.activationToken === token, 'Token de ativação divergente entre mensagem e banco');
            }
        }),
        simple(authRoutes.register, 'auth.cadastro.nascimento-invalido', {
            body: registration(fixtures.password, { birthDate: '2000-02-30' }), expectedStatus: 400
        }),
        simple(authRoutes.register, 'auth.cadastro.e-mail-duplicado', {
            body: registration(fixtures.password, { email: fixtures.users.member.email }), expectedStatus: 409
        })
    ];
}

function activationCases(fixtures) {
    const pendingForWorker = perWorker(fixtures, { active: false });
    return [
        scenario(authRoutes.activate, 'auth.ativacao.sucesso', async ({ phase }, request) => {
            const user = await fixtures.createUser({ active: false });
            const response = await request({ path: `/api/auth/activate/${user.activationToken}`, expectedStatus: 200 });
            if (phase === 'coverage' && response.status === 200) {
                const row = await fixtures.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
                assert.equal(row.status, 'Ativada');
                assert.ok(!row.activationToken && !row.activationExpiresAt, 'O link de ativação continuou válido');
            }
        }),
        simple(authRoutes.activate, 'auth.ativacao.token-invalido', {
            path: `/api/auth/activate/${missingToken}`, expectedStatus: 400
        }),
        scenario(authRoutes.resend, 'auth.ativacao.reenviar', async ({ workerId, phase }, request) => {
            const user = await pendingForWorker(workerId);
            const response = await request({ body: { email: user.email }, expectedStatus: 200 });
            if (response.status !== 200) return;
            const token = await mailboxToken(fixtures, user.email, 'activation');
            assert.ok(token !== user.activationToken, 'O reenvio preservou o token original');
            if (phase === 'coverage') {
                const row = await fixtures.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
                assert.ok(row.activationToken === token, 'Token do reenvio divergente entre mensagem e banco');
            }
        }),
        simple(authRoutes.resend, 'auth.ativacao.e-mail-inexistente', { body: { email: missingEmail }, expectedStatus: 404 }),
        simple(authRoutes.resend, 'auth.ativacao.conta-ja-ativa', {
            body: { email: fixtures.users.member.email }, expectedStatus: 400
        })
    ];
}

async function mintSession(prisma, userId) {
    const token = randomBytes(48).toString('hex');
    const { id } = await prisma.session.create({ data: { userId, sessionTokenHash: digest(token) }, select: { id: true } });
    return { id, cookie: `comanga_session=${token}` };
}

function sessionCases(fixtures) {
    const { prisma, password, users } = fixtures;
    const loginForWorker = perWorker(fixtures);
    const logoutForWorker = perWorker(fixtures);
    return [
        scenario(authRoutes.login, 'auth.login.sucesso', async ({ workerId }, request) => {
            const user = await loginForWorker(workerId);
            const response = await request({ body: { email: user.email, password }, expectedStatus: 200 });
            if (response.status === 200) {
                assert.equal(response.body.user.id, user.id);
                const cookie = response.headers.get('set-cookie') || '';
                assert.ok(cookie.startsWith('comanga_session=') && cookie.includes('HttpOnly'), 'Cookie de sessão esperado');
            }
        }),
        simple(authRoutes.login, 'auth.login.credenciais-invalidas', {
            body: { email: users.member.email, password: 'senha-incorreta-da-carga' }, expectedStatus: 401
        }, true),
        scenario(authRoutes.login, 'auth.login.conta-pendente', async (_context, request) => {
            const user = await fixtures.createUser({ active: false });
            await request({ body: { email: user.email, password }, expectedStatus: 403 });
        }, true),
        simple(authRoutes.login, 'auth.login.campos-ausentes', { body: {}, expectedStatus: 400 }),
        scenario(authRoutes.logout, 'auth.logout.sucesso', async ({ workerId, phase }, request) => {
            const user = await logoutForWorker(workerId);
            const session = await mintSession(prisma, user.id);
            const response = await request({ cookie: session.cookie, expectedStatus: 200 });
            if (phase === 'coverage' && response.status === 200) {
                const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
                assert.ok(row.revokedAt, 'Sessão continuou ativa após o logout');
            }
        }),
        scenario(authRoutes.me, 'auth.sessao.atual', async (_context, request) => {
            const response = await request({ cookie: users.member.cookie, expectedStatus: 200 });
            if (response.status === 200) assert.equal(response.body.user.id, users.member.id);
        })
    ];
}

function expectRecoveryLimit(response) {
    assert.equal(response.body.code, 'RECOVERY_RATE_LIMITED');
    assert.equal(response.headers.get('retry-after'), '900');
}

function recoveryCases(fixtures) {
    const { prisma, password } = fixtures;
    const recoveryForWorker = perWorker(fixtures);
    const resetUserForWorker = perWorker(fixtures);
    const replacement = `NovaCarga!${randomBytes(12).toString('hex')}7a`;
    let issuedRecovery;
    let resetLimitedUntil = 0;
    async function prepareReset(workerId) {
        const user = await resetUserForWorker(workerId);
        const token = randomBytes(32).toString('hex');
        const entry = await prisma.passwordResetToken.create({
            data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 3600000) }, select: { id: true }
        });
        return { user, token, entry };
    }
    return [
        scenario(authRoutes.forgot, 'auth.recuperacao.solicitar', async ({ workerId, phase }, request) => {
            const user = await recoveryForWorker(workerId);
            const response = await request({ body: { email: user.email }, expectedStatus: phase === 'load' ? [200, 429] : 200 });
            if (response.status === 429 && phase === 'load') expectRecoveryLimit(response);
            if (response.status === 200 && phase === 'coverage') {
                const token = await mailboxToken(fixtures, user.email, 'recovery');
                const entry = await prisma.passwordResetToken.findUnique({ where: { tokenHash: digest(token) } });
                assert.equal(entry?.userId, user.id);
                issuedRecovery = { user, token, entry };
            }
        }),
        simple(authRoutes.forgot, 'auth.recuperacao.e-mail-invalido', { body: { email: 'invalido' }, expectedStatus: 400 }, true),
        scenario(authRoutes.reset, 'auth.recuperacao.redefinir', async ({ workerId, phase }, request) => {
            let prepared = { token: missingToken };
            if (phase === 'coverage') {
                assert.ok(issuedRecovery, 'A solicitação anterior precisa ter emitido um token de recuperação');
                prepared = issuedRecovery;
            } else if (Date.now() >= resetLimitedUntil) {
                prepared = await prepareReset(workerId);
            }
            const response = await request({
                body: { token: prepared.token, password: replacement, confirmPassword: replacement },
                expectedStatus: phase === 'load' ? [200, 429] : 200
            });
            if (response.status === 429 && phase === 'load') {
                expectRecoveryLimit(response);
                // O limite permanece durante os estágios desta execução (até 10 minutos).
                resetLimitedUntil = Date.now() + 10 * 60 * 1000;
            }
            if (response.status === 200 && phase === 'coverage') {
                const user = await prisma.user.findUniqueOrThrow({ where: { id: prepared.user.id } });
                const entry = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: prepared.entry.id } });
                assert.ok(entry.usedAt, 'Token de recuperação não foi consumido');
                assert.ok(await bcrypt.compare(replacement, user.passwordHash), 'Senha não foi redefinida');
                assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 0);
            }
        }),
        simple(authRoutes.reset, 'auth.recuperacao.token-invalido', {
            body: { token: missingToken, password, confirmPassword: password }, expectedStatus: 400
        }, true)
    ];
}

function profileCases(fixtures) {
    const { users } = fixtures;
    const adultForWorker = perWorker(fixtures);
    const adminForWorker = perWorker(fixtures, { admin: true });
    const profileForWorker = new Map();
    return [
        scenario(userRoutes.me, 'usuario.perfil.consultar', async (_context, request) => {
            const response = await request({ cookie: users.member.cookie, expectedStatus: 200 });
            if (response.status === 200) assert.equal(response.body.user.username, users.member.username);
        }),
        scenario(userRoutes.adult, 'usuario.preferencia.adulta-ativar', async ({ workerId }, request) => {
            const user = await adultForWorker(workerId);
            const response = await request({ cookie: user.cookie, body: { conteudo_adulto: true }, expectedStatus: 200 });
            if (response.status === 200) assert.equal(response.body.conteudo_adulto, true);
        }),
        simple(userRoutes.adult, 'usuario.preferencia.tipo-invalido', {
            cookie: users.member.cookie, body: { conteudo_adulto: 'true' }, expectedStatus: 400
        }),
        scenario(userRoutes.adult, 'usuario.preferencia.idade-nao-informada', async (_context, request) => {
            const user = await fixtures.createUser({ birthDate: null });
            await request({ cookie: user.cookie, body: { conteudo_adulto: true }, expectedStatus: 403 });
        }, true),
        scenario(userRoutes.profile, 'usuario.perfil.trocar', async ({ workerId }, request) => {
            const user = await adminForWorker(workerId);
            const profile = profileForWorker.get(workerId) === standard ? administrator : standard;
            const response = await request({ cookie: user.cookie, body: { profile }, expectedStatus: 200 });
            if (response.status === 200) {
                assert.equal(response.body.user.active_profile, profile);
                profileForWorker.set(workerId, profile);
            }
        }),
        simple(userRoutes.profile, 'usuario.perfil.sem-atribuicao', {
            cookie: users.member.cookie, body: { profile: administrator }, expectedStatus: 403
        }),
        simple(userRoutes.profile, 'usuario.perfil.inexistente', {
            cookie: users.member.cookie, body: { profile: 'Perfil sintético inexistente' }, expectedStatus: 400
        })
    ];
}

function usernameCases(fixtures) {
    const usernameUser = perWorker(fixtures);
    return [
        scenario(userRoutes.username, 'usuario.nome.alterar', async ({ workerId }, request) => {
            const user = await usernameUser(workerId);
            const username = uniqueUsername();
            const response = await request({ cookie: user.cookie, body: { username }, expectedStatus: 200 });
            if (response.status === 200) assert.equal(response.body.user.username, username);
        }),
        simple(userRoutes.username, 'usuario.nome.invalido', {
            cookie: fixtures.users.member.cookie, body: { username: 'a' }, expectedStatus: 400
        })
    ];
}

function credentialCases(fixtures) {
    const { prisma, password, users } = fixtures;
    const userForChange = perWorker(fixtures);
    const replacement = `OutraCarga!${randomBytes(12).toString('hex')}7a`;
    const passwordForWorker = new Map();
    return [
        scenario(userRoutes.password, 'usuario.senha.alterar', async ({ workerId, phase }, request) => {
            const user = await userForChange(workerId);
            const currentPassword = passwordForWorker.get(workerId) ?? password;
            const newPassword = currentPassword === password ? replacement : password;
            const anotherSession = phase === 'coverage' ? await mintSession(prisma, user.id) : null;
            const response = await request({ cookie: user.cookie, body: { currentPassword, newPassword, confirmPassword: newPassword }, expectedStatus: 200 });
            if (response.status !== 200) return;
            passwordForWorker.set(workerId, newPassword);
            if (anotherSession) {
                const row = await prisma.session.findUniqueOrThrow({ where: { id: anotherSession.id } });
                assert.ok(row.revokedAt, 'A outra sessão da conta continuou ativa');
                assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 1);
            }
        }),
        simple(userRoutes.password, 'usuario.senha.confirmacao-invalida', {
            cookie: users.member.cookie, body: { currentPassword: password, newPassword: replacement, confirmPassword: password }, expectedStatus: 400
        }),
        simple(userRoutes.password, 'usuario.senha.senha-atual-incorreta', {
            cookie: users.member.cookie, body: { currentPassword: replacement, newPassword: password, confirmPassword: password }, expectedStatus: 401
        }, true),
        scenario(userRoutes.delete, 'usuario.conta.excluir', async ({ phase }, request) => {
            const user = await fixtures.createUser();
            const response = await request({ cookie: user.cookie, body: { currentPassword: password }, expectedStatus: 200 });
            if (response.status === 200 && phase === 'coverage') {
                assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
            }
        }),
        simple(userRoutes.delete, 'usuario.conta.senha-ausente', { cookie: users.member.cookie, body: {}, expectedStatus: 400 }),
        simple(userRoutes.delete, 'usuario.conta.senha-incorreta', {
            cookie: users.member.cookie, body: { currentPassword: replacement }, expectedStatus: 401
        }, true)
    ];
}

function createScenarios(fixtures) {
    const authenticated = { sessao: authRoutes.me, logout: authRoutes.logout, ...userRoutes };
    const denied = Object.entries(authenticated).map(([name, endpoint]) => simple(endpoint, `conta.${name}.sem-sessao`, {
        expectedStatus: 401
    }, true));
    return [
        ...registerCases(fixtures), ...activationCases(fixtures), ...sessionCases(fixtures), ...recoveryCases(fixtures),
        ...profileCases(fixtures), ...usernameCases(fixtures), ...credentialCases(fixtures), ...denied
    ];
}

module.exports = { routes: [...Object.values(authRoutes), ...Object.values(userRoutes)], createScenarios };
