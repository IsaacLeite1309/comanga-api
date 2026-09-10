process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../src/database');
const mailer = { sendActivationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() };
jest.mock('../src/utils/mailer', () => mailer);
const app = require('../src/app');
const { requestPasswordReset } = require('../src/modules/auth/passwordRecovery');
const { createTestCover } = require('./helpers/cover');
const { PrismaMediaAssetRepository } = require('../src/modules/admin/media/PrismaMediaAssetRepository');
const { CoverRemovalService } = require('../src/modules/admin/media/CoverRemovalService');
const prefix = `recovery_${Date.now()}`;
const pass = 'SenhaForte123!';
let user, typeId;
const covers = [];
async function cover() { const id = await createTestCover(db, prefix); covers.push(id); return id; }
async function work(id, suffix) {
    return db.query(`INSERT INTO works (title, slug, type_id, country, original_publication_status, cover_asset_id, atualizado_em)
        VALUES ($1, $1, $2, 'Japão', 'Completo', $3, NOW()) RETURNING id`, [`${prefix}_${suffix}`, typeId, id]);
}
describe('integração de autenticação e capas', () => {
beforeAll(async () => {
    const hash = await bcrypt.hash(pass, 10);
    user = (await db.query(`INSERT INTO users (username, email, password_hash, status, birth_date)
        VALUES ($1, $2, $3, 'Ativada', '2000-01-01') RETURNING id, email`, [prefix, `${prefix}@test.local`, hash])).rows[0];
    const cat = await db.query("SELECT id FROM domain_option_categories WHERE slug='tipos-obra'");
    typeId = (await db.query('INSERT INTO domain_option_values (category_id,label) VALUES ($1,$2) RETURNING id', [cat.rows[0].id, prefix])).rows[0].id;
});
afterAll(async () => {
    await db.query('DELETE FROM works WHERE title LIKE $1', [`${prefix}%`]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${prefix}/%`]);
    await db.query('DELETE FROM domain_option_values WHERE id=$1', [typeId]);
    await db.query('DELETE FROM users WHERE id=$1', [user.id]);
});

describe('senha e idade com banco real', () => {
    it.each([undefined, '', '2026-02-30', '2999-01-01'])('cadastro rejeita nascimento inválido %s', async birthDate => {
        const res = await request(app).post('/api/auth/register').send({ username: 'new_user', email: `${prefix}_invalid@test.local`, password: pass, confirmPassword: pass, birthDate });
        expect(res.status).toBe(400);
    });

    it('invalida token anterior, permite uma única redefinição concorrente e revoga login antigo', async () => {
        const login = await request(app).post('/api/auth/login').send({ email: user.email, password: pass });
        expect(login.status).toBe(200);
        for (let i = 0; i < 2; i++) {
            if (i) await db.query("UPDATE password_reset_tokens SET created_at=NOW() - INTERVAL '61 seconds' WHERE user_id=$1", [user.id]);
            expect((await request(app).post('/api/auth/forgot-password').send({ email: user.email })).status).toBe(200);
            // Delivery continues in the awaited handler after the neutral response.
            for (let attempt = 0; attempt < 100 && mailer.sendPasswordResetEmail.mock.calls.length < i + 1; attempt++) {
                await new Promise(resolve => global.setTimeout(resolve, 10));
            }
            expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(i + 1);
        }
        const oldToken = mailer.sendPasswordResetEmail.mock.calls[0][2];
        const token = mailer.sendPasswordResetEmail.mock.calls[1][2];
        const body = { token, password: 'SenhaNova123!', confirmPassword: 'SenhaNova123!' };
        expect((await request(app).post('/api/auth/reset-password').send({ ...body, token: oldToken })).status).toBe(400);
        const stored = await db.query('SELECT token_hash, used_at FROM password_reset_tokens WHERE user_id=$1', [user.id]);
        expect(stored.rows.map(row => row.token_hash)).not.toContain(token);
        expect(stored.rows.filter(row => row.used_at === null)).toHaveLength(1);
        const responses = await Promise.all([request(app).post('/api/auth/reset-password').send(body), request(app).post('/api/auth/reset-password').send(body)]);
        expect(responses.map(res => res.status).sort()).toEqual([200,400]);
        expect((await request(app).get('/api/auth/me').set('Cookie', login.headers['set-cookie'])).status).toBe(401);
        expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'SenhaNova123!' })).status).toBe(200);
    });
    it('limita emissões concorrentes por conta, mesmo de IPs distintos e com token consumido', async () => {
        await db.query("UPDATE password_reset_tokens SET created_at=NOW() - INTERVAL '61 seconds' WHERE user_id=$1", [user.id]);
        const before = mailer.sendPasswordResetEmail.mock.calls.length;
        const responses = [];
        await Promise.all(Array.from({ length: 10 }, (_, index) => {
            const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
            responses.push(res);
            return requestPasswordReset({ ip: `192.0.2.${index + 1}`, body: { email: user.email } }, res);
        }));
        expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(before + 1);
        const recent = await db.query("SELECT id FROM password_reset_tokens WHERE user_id=$1 AND created_at > NOW() - INTERVAL '60 seconds'", [user.id]);
        expect(recent.rows).toHaveLength(1);
        await db.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1', [recent.rows[0].id]);
        const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
        await requestPasswordReset({ body: { email: user.email } }, res);
        expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(before + 1);
        for (const response of [...responses, res]) {
            expect(response.status).toHaveBeenCalledWith(200);
            expect(response.json).toHaveBeenCalledWith({ message: 'Se houver uma conta apta para este e-mail, enviaremos as instruções de recuperação.' });
        }
    });
    it('preserva login de conta legada com senha acima de 72 bytes', async () => {
        const previous = (await db.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0].password_hash;
        const legacyPassword = 'A1!' + 'a'.repeat(75);
        try {
            await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(legacyPassword, 10), user.id]);
            const login = await request(app).post('/api/auth/login').send({ email: user.email, password: legacyPassword });
            expect(login.status).toBe(200);
        } finally {
            await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [previous, user.id]);
        }
    });
    it('rejeita menor mesmo com a preferência adulterada e mantém data privada', async () => {
        await db.query("UPDATE users SET birth_date=CURRENT_DATE - INTERVAL '17 years', conteudo_adulto=true WHERE id=$1",[user.id]);
        const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'SenhaNova123!' });
        const cookie = login.headers['set-cookie'];
        const profile = await request(app).get('/api/users/me').set('Cookie',cookie);
        expect(profile.body.user).toMatchObject({ conteudo_adulto:false, can_enable_adult_content:false });
        expect(profile.body.user).not.toHaveProperty('birthDate');
        expect((await request(app).patch('/api/users/me/adult-content').set('Cookie',cookie).send({ conteudo_adulto:true })).status).toBe(403);
        expect((await request(app).patch('/api/users/me/adult-content').set('Cookie',cookie).send({ conteudo_adulto:false })).status).toBe(200);
    });
});

describe('capas com concorrência e restrições reais', () => {
    it('aceita apenas uma associação concorrente para o mesmo ativo', async () => {
        const id = await cover();
        const results = await Promise.allSettled([work(id,'one'),work(id,'two')]);
        expect(results.filter(result => result.status==='fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status==='rejected')).toHaveLength(1);
    });
    it('não compartilha uma capa entre Obra e Edição em requisições concorrentes', async () => {
        const parent = await work(await cover(), 'parent-cross');
        const shared = await cover();
        const outcomes = await Promise.allSettled([
            work(shared, 'cross-work'),
            db.query(`INSERT INTO editions (work_id, brazilian_publisher_id, edition_type_id, cover_type_id, format_id, chronological_number, brazil_publication_status, cover_asset_id, atualizado_em)
                VALUES ($1,$2,$2,$2,$2,1,'Completo',$3,NOW()) RETURNING id`, [parent.rows[0].id, typeId, shared])
        ]);
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
        await db.query('DELETE FROM editions WHERE work_id=$1', [parent.rows[0].id]);
    });
    it('marca capas intermediárias como descarte em duas substituições simultâneas', async () => {
        const [a,b,c]=await Promise.all([cover(),cover(),cover()]);
        const created=await work(a,'replacement');
        await Promise.all([b,c].map(id=>db.query('UPDATE works SET cover_asset_id=$1 WHERE id=$2',[id,created.rows[0].id])));
        const states=await db.query('SELECT status FROM media_assets WHERE id=ANY($1::uuid[])',[[a,b,c]]);
        expect(states.rows.filter(row=>row.status==='Descartando')).toHaveLength(2);
        await expect(db.query('DELETE FROM media_assets WHERE id=(SELECT cover_asset_id FROM works WHERE id=$1)',[created.rows[0].id])).rejects.toMatchObject({code:'23503'});
    });
    it('impede associação durante exclusão física e permite retry após falha do storage', async () => {
        const id=await cover();
        await db.query('UPDATE media_assets SET created_by_user_id=$1 WHERE id=$2',[user.id,id]);
        const repository=new PrismaMediaAssetRepository();
        const storage={deleteObjects:jest.fn(async()=>{
            await expect(work(id,'while-deleting')).rejects.toMatchObject({code:'23514'});
            throw new Error('storage indisponível');
        })};
        const service=new CoverRemovalService({repository,storage});
        await expect(service.removePending({assetId:id,userId:user.id})).rejects.toThrow('storage indisponível');
        expect((await db.query('SELECT status FROM media_assets WHERE id=$1',[id])).rows[0].status).toBe('Descartando');
        storage.deleteObjects.mockResolvedValue(undefined);
        await service.removePending({assetId:id,userId:user.id});
        expect((await db.query('SELECT id FROM media_assets WHERE id=$1',[id])).rows).toHaveLength(0);
    });

    it('admin menor consulta catálogo administrativo, mas não obtém conteúdo adulto público', async () => {
        const id = await cover(); const created = await work(id, 'adult'); const workId = created.rows[0].id;
        await db.query("UPDATE works SET adult_content=true, visibility='Público' WHERE id=$1",[workId]);
        await db.query("UPDATE users SET nivel_acesso='Administrador', birth_date=CURRENT_DATE - INTERVAL '17 years', conteudo_adulto=true WHERE id=$1",[user.id]);
        const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'SenhaNova123!' });
        const cookie = login.headers['set-cookie'];
        expect((await request(app).get(`/api/admin/works/${workId}`).set('Cookie',cookie)).status).toBe(200);
        expect((await request(app).get(`/api/public/works/${prefix}_adult`).set('Cookie',cookie)).status).toBe(404);
        await db.query("UPDATE users SET nivel_acesso='Usuário Padrão' WHERE id=$1",[user.id]);
        expect((await request(app).get(`/api/admin/works/${workId}`).set('Cookie',cookie)).status).toBe(403);
    });
    it('recusa capa nula e recusa reativar um ativo em descarte',async()=>{
        await expect(work(null,'null')).rejects.toMatchObject({code:'23514'});
        const id=await cover();
        await db.query("UPDATE media_assets SET status='Descartando' WHERE id=$1",[id]);
        await expect(db.query("UPDATE media_assets SET status='Ativo' WHERE id=$1",[id])).rejects.toMatchObject({code:'23514'});
    });
});

});
