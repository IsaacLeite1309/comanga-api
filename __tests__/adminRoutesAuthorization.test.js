const crypto = require('node:crypto');
const request = require('supertest');

const app = require('../src/app');
const db = require('../src/database');
const adminRoutes = require('../src/routes/adminRoutes');

const prefix = `authz_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const emailDomain = 'admin-authz-test.local';

const PARAM_SAMPLES = {
    id: '999999',
    assetId: '00000000-0000-4000-8000-000000000000',
    category: 'generos',
    slug: 'obra-inexistente',
    workId: '999999',
    editionId: '999999'
};

function listAdminRoutes() {
    return adminRoutes.stack
        .filter((layer) => layer.route)
        .flatMap((layer) => Object.keys(layer.route.methods)
            .filter((method) => method !== '_all')
            .map((method) => ({
                method,
                template: layer.route.path,
                path: `/api/admin${layer.route.path.replace(/:([A-Za-z]+)/g, (_match, name) => {
                    if (!(name in PARAM_SAMPLES)) throw new Error(`Parâmetro de rota sem exemplo: ${name}`);
                    return PARAM_SAMPLES[name];
                })}`
            })));
}

const adminRouteCases = listAdminRoutes().map((route) => [`${route.method.toUpperCase()} ${route.template}`, route]);

async function createUser({ suffix, role, status = 'Ativada' }) {
    const result = await db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, birth_date, conteudo_adulto)
         VALUES ($1, $2, 'not-used', $3, $4, '2000-01-01', false)
         RETURNING id`,
        [`${prefix}_${suffix}`.slice(0, 50), `${prefix}_${suffix}@${emailDomain}`, status, role]
    );
    return result.rows[0].id;
}

async function createSessionCookie(userId, { revoked = false } = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
        `INSERT INTO sessions (user_id, session_token_hash, revoked_at)
         VALUES ($1, $2, $3)`,
        [userId, crypto.createHash('sha256').update(token).digest('hex'), revoked ? new Date() : null]
    );
    return `comanga_session=${token}`;
}

describe('autorização de todas as rotas administrativas', () => {
    const cookies = {};

    beforeAll(async () => {
        const standardUserId = await createUser({ suffix: 'padrao', role: 'Usuário Padrão' });
        const pendingAdminId = await createUser({ suffix: 'pendente', role: 'Administrador', status: 'Pendente' });
        cookies.standard = await createSessionCookie(standardUserId);
        cookies.revoked = await createSessionCookie(standardUserId, { revoked: true });
        cookies.pendingAdmin = await createSessionCookie(pendingAdminId);
    });

    afterAll(async () => {
        await db.query('DELETE FROM users WHERE email LIKE $1', [`${prefix}%@${emailDomain}`]);
    });

    it('mantém a composição administrativa sob prefixo único e com rotas declaradas', () => {
        expect(adminRouteCases.length).toBeGreaterThanOrEqual(28);
    });

    it.each(adminRouteCases)('%s recusa requisição sem sessão com 401', async (_nome, route) => {
        const response = await request(app)[route.method](route.path).send({});

        expect(response.status).toBe(401);
        expect(response.body.error).toMatch(/sessão/i);
    });

    it.each(adminRouteCases)('%s recusa sessão revogada com 401', async (_nome, route) => {
        const response = await request(app)[route.method](route.path)
            .set('Cookie', cookies.revoked)
            .send({});

        expect(response.status).toBe(401);
    });

    it.each(adminRouteCases)('%s recusa sessão de usuário padrão com 403', async (_nome, route) => {
        const response = await request(app)[route.method](route.path)
            .set('Cookie', cookies.standard)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/permiss/i);
    });

    it.each(adminRouteCases)('%s recusa conta administrativa ainda não ativada com 403', async (_nome, route) => {
        const response = await request(app)[route.method](route.path)
            .set('Cookie', cookies.pendingAdmin)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/conta/i);
    });
});
