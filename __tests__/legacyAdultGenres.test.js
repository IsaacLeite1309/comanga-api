process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database');
const { createTestCover } = require('./helpers/cover');

const prefix = `legacy_adult_${crypto.randomUUID()}`;
const fixture = { options: [], users: [], works: [], editions: [] };
const migrationPath = path.join(__dirname, '../prisma/migrations/20260922130000_protect_legacy_adult_genres/migration.sql');

async function migrate() {
    await db.query(fs.readFileSync(migrationPath, 'utf8'));
}

async function option(category, label, active = true) {
    const result = await db.query(`INSERT INTO domain_option_values(category_id,label,active)
        SELECT id,$2,$3 FROM domain_option_categories WHERE slug=$1 RETURNING id`, [category, label, active]);
    fixture.options.push(result.rows[0].id);
    return result.rows[0].id;
}

async function session(suffix, adult, admin = false, minor = false) {
    const user = (await db.query(`INSERT INTO users(username,email,password_hash,status,nivel_acesso,birth_date,conteudo_adulto)
        VALUES($1,$2,'unused','Ativada',$3,CURRENT_DATE - make_interval(years => $4),$5) RETURNING id`,
    [crypto.randomUUID().slice(0, 20), `${prefix}-${suffix}@test.local`, admin ? 'Administrador' : 'Usuário Padrão', minor ? 17 : 30, adult])).rows[0];
    fixture.users.push(user.id);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(`INSERT INTO sessions(user_id,session_token_hash,active_profile_id)
        SELECT $1,$2,id FROM profiles WHERE code=$3`,
    [user.id, crypto.createHash('sha256').update(token).digest('hex'), suffix === 'writer' ? 'ADMINISTRADOR' : 'USUARIO_PADRAO']);
    return `comanga_session=${token}`;
}

async function createWork(type, genre, suffix) {
    const slug = `${prefix}-${suffix}`;
    const row = (await db.query(`INSERT INTO works(cover_asset_id,slug,title,romanized_title,synopsis,type_id,country,
        original_publication_status,visibility,adult_content,atualizado_em)
        VALUES($1,$2::text,$2::text,$2::text,$2::text,$3,'Japão','Completa','Público',FALSE,NOW()) RETURNING id`,
    [await createTestCover(db, prefix), slug, type])).rows[0];
    fixture.works.push(row.id);
    if (genre) await db.query('INSERT INTO work_genres(work_id,genre_id) VALUES($1,$2)', [row.id, genre]);
    return { id: row.id, slug };
}

let aliases, main, free, editionId, volumeId, authorId, writer;
const viewers = {};

describe('gêneros adultos legados', () => {
beforeAll(async () => {
    aliases = await Promise.all(['Héntai', "Hen'tai", ' Hentai '].map((label, i) => option('generos', label, i !== 2)));
    const type = (await db.query("SELECT id FROM domain_option_values WHERE code='manga'")).rows[0].id;
    for (const [i, alias] of aliases.entries()) {
        const work = await createWork(type, alias, `alias-${i}`);
        if (i === 0) main = work;
    }
    free = await createWork(type, null, 'livre');
    authorId = await option('autores', prefix);
    await db.query('INSERT INTO work_authors(work_id,author_id) VALUES($1,$2)', [main.id, authorId]);
    const publisher = await option('editoras-brasileiras', prefix);
    editionId = (await db.query(`INSERT INTO editions(work_id,brazilian_publisher_id,chronological_number,
        brazil_publication_status,visibility,atualizado_em) VALUES($1,$2,1,'Completa','Público',NOW()) RETURNING id`,
    [main.id, publisher])).rows[0].id;
    fixture.editions.push(editionId);
    volumeId = (await db.query(`INSERT INTO volumes(edition_id,number,cover_asset_id,release_date_precision,release_year,visibility,atualizado_em)
        VALUES($1,1,$2,'Ano',2026,'Público',NOW()) RETURNING id`, [editionId, await createTestCover(db, prefix)])).rows[0].id;
    writer = await session('writer', false, true);
    viewers.minor = await session('minor', true, false, true);
    viewers.disabled = await session('disabled', false);
    viewers.enabled = await session('enabled', true);
    viewers.adminStandard = await session('admin-standard', false, true);
    await migrate();
});

afterAll(async () => {
    await db.query('DELETE FROM volumes WHERE edition_id=ANY($1::int[])', [fixture.editions]);
    await db.query('DELETE FROM editions WHERE id=ANY($1::int[])', [fixture.editions]);
    await db.query('DELETE FROM works WHERE id=ANY($1::int[])', [fixture.works]);
    await db.query('DELETE FROM domain_option_values WHERE id=ANY($1::int[])', [fixture.options]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [fixture.users]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${prefix}/%`]);
});

it('normaliza aliases adultos sem alterar IDs, nomes, ativação ou vínculos e pode reexecutar', async () => {
    const before = (await db.query('SELECT id,label,code,system_managed,active FROM domain_option_values WHERE id=ANY($1::int[]) ORDER BY id', [aliases])).rows;
    await migrate();
    await migrate();
    expect((await db.query('SELECT id,label,code,system_managed,active FROM domain_option_values WHERE id=ANY($1::int[]) ORDER BY id', [aliases])).rows).toEqual(before);
    expect((await db.query('SELECT adult_content FROM works WHERE id=ANY($1::int[])', [fixture.works.filter(id => id !== free.id)])).rows)
        .toEqual([{ adult_content: true }, { adult_content: true }, { adult_content: true }]);
    expect((await db.query('SELECT genre_id FROM work_genres WHERE work_id=$1', [main.id])).rows).toEqual([{ genre_id: aliases[0] }]);
    expect((await db.query('SELECT adult_content FROM works WHERE id=$1', [free.id])).rows[0].adult_content).toBe(false);
});

it.each([
    ['visitante', null, false], ['menor', 'minor', false], ['preferência desligada', 'disabled', false],
    ['adulto autorizado', 'enabled', true], ['administrador em perfil padrão', 'adminStandard', true]
])('aplica a restrição ao alias em todas as leituras: %s', async (_label, key, allowed) => {
    // A leitura deve proteger até uma flag de Obra inconsistente com o vínculo adulto.
    await db.query('UPDATE works SET adult_content=FALSE WHERE id=$1', [main.id]);
    async function get(url, query = {}) {
        const call = request(app).get(url).query(query);
        if (key) call.set('Cookie', viewers[key]);
        return call;
    }
    const works = await get('/api/public/works', { term: main.slug });
    expect(works.status).toBe(200);
    expect(works.body.works.map(w => w.id)).toEqual(allowed ? [main.id] : []);
    for (const url of [`/api/public/works/${main.slug}`, `/api/public/editions/${editionId}`, `/api/public/volumes/${volumeId}`]) {
        expect((await get(url)).status).toBe(allowed ? 200 : 404);
    }
    const editions = await get('/api/public/editions', { term: main.slug });
    expect(editions.body.editions.map(e => e.id)).toEqual(allowed ? [editionId] : []);
    const authored = await get(`/api/public/authors/${authorId}/works`);
    expect(authored.body.works.map(w => w.id)).toEqual(allowed ? [main.id] : []);
    const options = await get('/api/public/catalog-options');
    expect(options.body.options.genres.some(g => g.id === aliases[0])).toBe(allowed);
});

it.each([{ adultContent: false }, { genreIds: 'linked', adultContent: false }])('impede desmarcar adulto preservando o alias legado: %j', async body => {
    const payload = body.genreIds ? { ...body, genreIds: [aliases[0]] } : body;
    const response = await request(app).patch(`/api/admin/works/${main.id}`).set('Cookie', writer).send(payload);
    expect(response.status).toBe(200);
    expect(response.body.work.adultContent).toBe(true);
});

it('continua bloqueando nova associação ao alias legado', async () => {
    const response = await request(app).patch(`/api/admin/works/${free.id}`).set('Cookie', writer).send({ genreIds: [aliases[0]] });
    expect(response.status).toBe(400);
    expect((await db.query('SELECT * FROM work_genres WHERE work_id=$1', [free.id])).rows).toEqual([]);
});

});
