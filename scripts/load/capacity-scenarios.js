const assert = require('node:assert/strict');

function read(name, endpoint, path, cookie, verify) {
    return { name, endpoint, async run({ request }) {
        const response = await request({ path, cookie, expectedStatus: 200 });
        verify(response.body);
    } };
}

function nonEmptyList(key) {
    return body => assert.ok(Array.isArray(body[key]) && body[key].length > 0, `Lista ${key} vazia ou inválida.`);
}

function readOperations({ catalog, users }) {
    const work = `/api/public/works/${catalog.workSlug}`;
    const edition = `${work}/editions/${catalog.editionNumber}`;
    return {
        search: read('pesquisa paginada de obras', 'GET /api/public/works', '/api/public/works?page=1&limit=24&term=Carga', undefined, nonEmptyList('works')),
        work: read('detalhes da obra', 'GET /api/public/works/:slug', work, undefined, body => assert.equal(body.work.slug, catalog.workSlug)),
        edition: read('detalhes da edição', 'GET /api/public/works/:slug/editions/:editionNumber', `${edition}?page=1&limit=24`, undefined, nonEmptyList('volumes')),
        volume: read('detalhes do volume', 'GET /api/public/works/:slug/editions/:editionNumber/volumes/:volumeNumber', `${edition}/volumes/${catalog.volumeNumber}`, undefined, body => assert.equal(body.volume.number, catalog.volumeNumber)),
        calendar: read('lançamentos do mês', 'GET /api/public/calendar', `/api/public/calendar?year=${catalog.releaseYear}&month=${catalog.releaseMonth}&page=1&limit=24`, undefined, nonEmptyList('volumes')),
        collection: read('coleção autenticada', 'GET /api/users/me/collection', '/api/users/me/collection?page=1&limit=12', users.member.cookie, nonEmptyList('works')),
        wishlist: read('desejos autenticados', 'GET /api/users/me/wishlist', '/api/users/me/wishlist?page=1&limit=24', users.member.cookie, nonEmptyList('volumes'))
    };
}

function collectionWrite(catalog, workers) {
    const endpoint = 'PUT /api/users/me/collection/volumes/:volumeId';
    const path = `/api/users/me/collection/volumes/${catalog.volumeIds[0]}`;
    return {
        name: 'adicionar, marcar leitura e remover da coleção', endpoint,
        covers: ['PATCH /api/users/me/collection/volumes/:volumeId', 'DELETE /api/users/me/collection/volumes/:volumeId'],
        async run({ request, workerId }) {
            const cookie = workers[workerId].cookie;
            const owned = await request({ method: 'PUT', path, cookie, expectedStatus: 200 });
            assert.equal(owned.body.owned, true);
            const read = await request({ method: 'PATCH', path, cookie, body: { read: true }, expectedStatus: 200 });
            assert.equal(read.body.read, true);
            await request({ method: 'DELETE', path, cookie, expectedStatus: 204 });
        }
    };
}

function coverImport(admin) {
    return {
        name: 'importação e descarte de capa sintética 800x1200', endpoint: 'POST /api/admin/media/covers',
        covers: ['DELETE /api/admin/media/covers/:assetId'],
        async run({ request }) {
            const response = await request({ method: 'POST', path: '/api/admin/media/covers', cookie: admin.cookie,
                body: { sourceUrl: 'https://fixture.invalid/capa.png' }, expectedStatus: 201 });
            assert.equal(typeof response.body.asset.id, 'string');
            await request({ method: 'DELETE', path: `/api/admin/media/covers/${response.body.asset.id}`,
                cookie: admin.cookie, expectedStatus: 204 });
        }
    };
}

async function makeCapacityOperations(fixtures, config) {
    const operations = readOperations(fixtures);
    const workers = [];
    if (['all', 'collection-write'].includes(config.operation)) {
        for (let index = 0; index < Math.max(...config.stages); index++) workers.push(await fixtures.createUser());
    }
    operations['collection-write'] = collectionWrite(fixtures.catalog, workers);
    operations.covers = coverImport(fixtures.users.admin);
    if (config.operation === 'all') return Object.entries(operations).map(([name, scenario]) => ({ name, scenarios: [scenario] }));
    if (config.operation === 'browse') {
        return [{ name: 'browse', scenarios: ['search', 'work', 'edition', 'volume', 'calendar', 'collection', 'wishlist'].map(key => operations[key]) }];
    }
    return [{ name: config.operation, scenarios: [operations[config.operation]] }];
}

module.exports = { makeCapacityOperations };
