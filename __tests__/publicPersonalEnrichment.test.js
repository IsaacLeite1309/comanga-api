process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database');
const { fixture } = require('./helpers/personalCatalog');
let f;

beforeEach(async () => { f = await fixture(); });
afterEach(async () => { if (f) await f.cleanup(); });

function details(kind, user) {
    const path = { work: `works/${f.prefix}`, edition: `editions/${f.editionId}`, volume: `volumes/${f.first}` }[kind];
    const pending = request(app).get(`/api/public/${path}`);
    return user ? pending.set('Cookie', user.cookie) : pending;
}
async function saved(user, volumeId, state, read = null) {
    await db.query('INSERT INTO user_volumes(user_id,volume_id,state,read) VALUES($1,$2,$3,$4)', [user.id, volumeId, state, read]);
}
function privateResponse(response) {
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.vary).toContain('Cookie');
}

it.each(['work', 'edition', 'volume'])('detalhes de %s funcionam anonimamente sem campos pessoais', async kind => {
    await saved(f.owner, f.first, 'Owned', true);
    const response = await details(kind);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('"personal":');
    privateResponse(response);
});

it('estado e contadores aparecem somente para a conta da sessão e sem identificadores pessoais', async () => {
    await saved(f.owner, f.first, 'Owned', true);
    await saved(f.owner, f.second, 'Wanted');
    await saved(f.other, f.first, 'Wanted');
    await saved(f.other, f.third, 'Owned', false);
    const owner = await details('volume', f.owner);
    const other = await details('volume', f.other);
    expect(owner.body.volume.personal).toEqual({ owned: true, read: true, wished: false });
    expect(other.body.volume.personal).toEqual({ owned: false, read: null, wished: true });
    privateResponse(owner); privateResponse(other);
    for (const kind of ['work', 'edition']) {
        const response = await details(kind, f.owner);
        expect(response.body[kind].personal).toEqual({ ownedCount: 1, readCount: 1, wishedCount: 1 });
        expect(JSON.stringify(response.body)).not.toContain(f.owner.id);
        expect(JSON.stringify(response.body)).not.toContain(f.other.id);
        const edition = kind === 'work' ? response.body.work.editions[0] : response.body.edition;
        if (kind === 'work') expect(edition.personal).toEqual(response.body.work.personal);
        const volumes = kind === 'work' ? edition.volumes : response.body.volumes;
        expect(volumes.find(volume => volume.id === f.first).personal).toEqual(owner.body.volume.personal);
        expect(volumes.find(volume => volume.id === f.second).personal).toEqual({ owned: false, read: null, wished: true });
        expect(volumes.find(volume => volume.id === f.third).personal).toEqual({ owned: false, read: null, wished: false });
    }
});

it('sessão revogada, cookie inválido e conta inativa mantêm resposta pública sem dados pessoais', async () => {
    await saved(f.owner, f.first, 'Owned', true);
    await db.query('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1', [f.owner.id]);
    await db.query("UPDATE users SET status='Bloqueada' WHERE id=$1", [f.other.id]);
    for (const user of [f.owner, f.other, { cookie: 'comanga_session=invalid' }]) {
        for (const kind of ['work', 'edition', 'volume']) {
            const response = await details(kind, user);
            expect(response.status).toBe(200);
            expect(JSON.stringify(response.body)).not.toContain('"personal":');
            privateResponse(response);
        }
    }
});

it('contadores consideram todos os volumes públicos além da prévia e da página', async () => {
    const fourth = await f.volume(4), fifth = await f.volume(5), sixth = await f.volume(6);
    await saved(f.owner, sixth, 'Owned', true);
    await saved(f.owner, fifth, 'Wanted');
    await saved(f.owner, fourth, 'Owned', false);
    const work = await details('work', f.owner);
    expect(work.body.work.personal).toEqual({ ownedCount: 2, readCount: 1, wishedCount: 1 });
    const edition = await request(app).get(`/api/public/editions/${f.editionId}?limit=1`).set('Cookie', f.owner.cookie);
    expect(edition.body.volumes).toHaveLength(1);
    expect(edition.body.edition.personal).toEqual(work.body.work.personal);
    await db.query("UPDATE volumes SET visibility='Privado' WHERE id=$1", [sixth]);
    expect((await details('work', f.owner)).body.work.personal).toEqual({ ownedCount: 1, readCount: 0, wishedCount: 1 });
    expect((await details('edition', f.owner)).body.edition.personal).toEqual({ ownedCount: 1, readCount: 0, wishedCount: 1 });
});

it.each(['work', 'edition', 'volume'])('recurso %s privado permanece inacessível e respostas de erro não podem ser cacheadas', async kind => {
    await saved(f.owner, f.first, 'Owned', true);
    const [table, id] = { work: ['works', f.workId], edition: ['editions', f.editionId], volume: ['volumes', f.first] }[kind];
    await db.query(`UPDATE ${table} SET visibility='Privado' WHERE id=$1`, [id]);
    const response = await details(kind, f.owner);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('"personal":');
    privateResponse(response);
});

it('enriquecimento respeita política adulta e se atualiza depois de operações pessoais', async () => {
    await db.query('UPDATE works SET adult_content=true WHERE id=$1', [f.workId]);
    expect((await details('work', f.owner)).status).toBe(404);
    await db.query('UPDATE users SET conteudo_adulto=true WHERE id=$1', [f.owner.id]);
    expect((await details('volume', f.owner)).body.volume.personal).toEqual({ owned: false, read: null, wished: false });
    await request(app).put(`/api/users/me/wishlist/volumes/${f.first}`).set('Cookie', f.owner.cookie);
    expect((await details('volume', f.owner)).body.volume.personal.wished).toBe(true);
    await request(app).put(`/api/users/me/collection/volumes/${f.first}`).set('Cookie', f.owner.cookie);
    expect((await details('volume', f.owner)).body.volume.personal).toEqual({ owned: true, read: false, wished: false });
    expect((await details('work', f.other)).status).toBe(404);
});

it('erros de parâmetros e consultas usam política de cache privada', async () => {
    for (const path of ['/volumes/invalid', '/editions/invalid', `/editions/${f.editionId}?page=0`]) {
        const response = await request(app).get(`/api/public${path}`);
        expect(response.status).toBe(400);
        privateResponse(response);
    }
});
