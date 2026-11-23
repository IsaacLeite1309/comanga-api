const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');

const auth = 'Sessão ativa com perfil Administrador e atribuição vigente';
const database = 'PostgreSQL';
const mediaStorage = 'Cloudflare R2 simulado em memória';
const pagination = 'Consulta: page, limit, order';
const editionAddress = '/works/slug/:workSlug/editions/:editionNumber';
const noId = 2_147_483_647;
const noUuid = '00000000-0000-4000-8000-000000000000';
const noSlug = 'obra-ausente-da-fixture';
const managedCategory = 'generos';
const editableCategory = 'editoras-brasileiras';
const adminRole = 'Administrador';
const memberRole = 'Usuário Padrão';
const coverInput = { sourceUrl: 'https://fixture.invalid/capa.png' };

function endpoint(method, path, parameters = [], dependencies = [database]) {
    return { method, path: `/api/admin${path}`, auth, parameters, dependencies };
}

const admin = {
    users: endpoint('GET', '/users', [pagination, 'Consulta: term, role, status']),
    role: endpoint('PATCH', '/users/:id/role', ['Rota: id (UUID do usuário)', 'Corpo: role']),
    options: endpoint('GET', '/options/:category', [pagination, 'Rota: category', 'Consulta: term, includeInactive']),
    createOption: endpoint('POST', '/options', ['Corpo: category, label']),
    updateOption: endpoint('PATCH', '/options/:id', ['Rota: id da opção', 'Corpo: label, dependsOnValueIds, active']),
    deleteOption: endpoint('DELETE', '/options/:id', ['Rota: id da opção']),
    importCover: endpoint('POST', '/media/covers', ['Corpo: sourceUrl (HTTPS)'], [database, 'Download HTTPS simulado', 'Sharp', mediaStorage]),
    deleteCover: endpoint('DELETE', '/media/covers/:assetId', ['Rota: assetId (UUID)'], [database, mediaStorage]),
    workOptions: endpoint('GET', '/works/form-options'),
    editionOptions: endpoint('GET', '/editions/form-options'),
    works: endpoint('GET', '/works', [pagination, 'Consulta: term, typeId, demography, visibility, sortBy']),
    createWork: endpoint('POST', '/works', [
        'Corpo: title, romanizedTitle, synopsis, typeId, originalPublicationStatus, coverAssetId, authors',
        'Corpo opcional: originalTitle, originalPublicationStartYear, originalPublicationEndYear, directRelease, adultContent, genreIds, demographies, originalPublisherIds, magazineIds'
    ]),
    workSlug: endpoint('GET', '/works/slug/:slug', ['Rota: slug da obra']),
    editionNumber: endpoint('GET', editionAddress, ['Rota: workSlug, editionNumber']),
    volumeNumber: endpoint('GET', `${editionAddress}/volumes/:volumeNumber`, ['Rota: workSlug, editionNumber, volumeNumber']),
    createEdition: endpoint('POST', '/works/:workId/editions', [
        'Rota: workId', 'Corpo: brazilianPublisherId, coverTypeId, formatId, paperIds, chronologicalNumber, brazilPublicationStatus'
    ]),
    editions: endpoint('GET', '/works/:workId/editions', [pagination, 'Rota: workId']),
    createVolume: endpoint('POST', '/editions/:editionId/volumes', [
        'Rota: editionId', 'Corpo: number, coverAssetId, releaseDatePrecision, releaseYear, releaseMonth, releaseDay',
        'Corpo opcional: singleVolume, pages, priceCurrency, price, isbn10, isbn13, affiliateLink, synopsis'
    ]),
    volumes: endpoint('GET', '/editions/:editionId/volumes', [pagination, 'Rota: editionId']),
    workVisibility: endpoint('PATCH', '/works/:id/visibility', ['Rota: id da obra', 'Corpo: visibility']),
    work: endpoint('GET', '/works/:id', ['Rota: id da obra']),
    updateWork: endpoint('PATCH', '/works/:id', ['Rota: id da obra', 'Corpo: campos da criação de obra, todos opcionais'], [database, mediaStorage]),
    deleteWork: endpoint('DELETE', '/works/:id', ['Rota: id da obra'], [database, mediaStorage]),
    edition: endpoint('GET', '/editions/:id', ['Rota: id da edição']),
    updateEdition: endpoint('PATCH', '/editions/:id', ['Rota: id da edição', 'Corpo: campos da criação de edição, todos opcionais']),
    deleteEdition: endpoint('DELETE', '/editions/:id', ['Rota: id da edição']),
    editionVisibility: endpoint('PATCH', '/editions/:id/visibility', ['Rota: id da edição', 'Corpo: visibility']),
    volume: endpoint('GET', '/volumes/:id', ['Rota: id do volume']),
    updateVolume: endpoint('PATCH', '/volumes/:id', ['Rota: id do volume', 'Corpo: campos da criação de volume, todos opcionais'], [database, mediaStorage]),
    deleteVolume: endpoint('DELETE', '/volumes/:id', ['Rota: id do volume'], [database, mediaStorage])
};

const routes = Object.values(admin);
const exampleParams = {
    id: noId,
    assetId: noUuid,
    category: managedCategory,
    slug: noSlug,
    workId: noId,
    editionId: noId,
    workSlug: noSlug,
    editionNumber: 1,
    volumeNumber: 1
};

function send(request, route, { params = {}, query, cookie, body, expectedStatus }) {
    const path = route.path.replace(/:(\w+)/g, (_match, name) => encodeURIComponent(params[name] ?? exampleParams[name]));
    const queryString = query ? `?${new URLSearchParams(query)}` : '';
    return request({ method: route.method, path: `${path}${queryString}`, cookie, body, expectedStatus });
}

function routeKey(route) {
    return `${route.method} ${route.path}`;
}

function scenario(name, primary, run, additionalRoutes = []) {
    return { name: `admin/${name}`, endpoint: routeKey(primary), covers: additionalRoutes.map(routeKey), run };
}

function singleRequest(name, route, options) {
    return scenario(name, route, ({ request }) => send(request, route, options));
}

function authorizationScenarios(member) {
    return routes.flatMap((route) => {
        const name = routeKey(route).replace('/api/admin', '');
        const params = route === admin.role ? { id: noUuid } : {};
        const body = ['POST', 'PATCH'].includes(route.method) ? {} : undefined;
        return [
            singleRequest(`sem sessão ${name}`, route, { params, body, expectedStatus: 401 }),
            singleRequest(`sem permissão ${name}`, route, { params, body, cookie: member.cookie, expectedStatus: 403 })
        ];
    });
}

function readScenarios(users, catalog) {
    const paginationQuery = { page: 1, limit: 5, order: 'ASC' };
    const editionAddressParams = { workSlug: catalog.workSlug, editionNumber: catalog.editionNumber };
    const cases = [
        ['listar usuários', admin.users, {}, { ...paginationQuery, term: users.admin.username, role: adminRole, status: 'Ativada' }],
        ['listar opções', admin.options, { category: 'tipos-obra' }, paginationQuery],
        ['opções do formulário de obras', admin.workOptions],
        ['opções do formulário de edições', admin.editionOptions],
        ['listar obras', admin.works, {}, { ...paginationQuery, typeId: catalog.typeId, visibility: 'Público', sortBy: 'title' }],
        ['consultar obra por slug', admin.workSlug, { slug: catalog.workSlug }],
        ['consultar obra por ID', admin.work, { id: catalog.workId }],
        ['consultar edição por número', admin.editionNumber, editionAddressParams],
        ['consultar edição por ID', admin.edition, { id: catalog.editionId }],
        ['listar edições da obra', admin.editions, { workId: catalog.workId }, paginationQuery],
        ['consultar volume por número', admin.volumeNumber, { ...editionAddressParams, volumeNumber: catalog.volumeNumber }],
        ['consultar volume por ID', admin.volume, { id: catalog.volumeIds[0] }],
        ['listar volumes da edição', admin.volumes, { editionId: catalog.editionId }, paginationQuery]
    ];
    return cases.map(([name, route, params, query]) => singleRequest(name, route, {
        params, query, cookie: users.admin.cookie, expectedStatus: 200
    }));
}

function validationScenarios(cookie) {
    const invalidQuery = [admin.users, admin.options, admin.works, admin.editions, admin.volumes];
    const invalidBody = [
        admin.role, admin.createOption, admin.updateOption, admin.importCover, admin.createWork,
        admin.createEdition, admin.createVolume, admin.updateWork, admin.updateEdition, admin.updateVolume,
        admin.workVisibility, admin.editionVisibility
    ];
    const invalidParams = [
        [admin.deleteOption, { id: 0 }],
        [admin.deleteCover, { assetId: 'invalido' }],
        [admin.work, { id: 0 }],
        [admin.workSlug, { slug: 'slug inválido' }],
        [admin.editionNumber, { editionNumber: 0 }],
        [admin.volumeNumber, { volumeNumber: 'invalido' }],
        [admin.edition, { id: 0 }],
        [admin.deleteWork, { id: 0 }],
        [admin.deleteEdition, { id: 0 }],
        [admin.volume, { id: 0 }],
        [admin.deleteVolume, { id: 0 }]
    ];
    const cases = [
        ...invalidQuery.map((route) => [route, { query: { page: 0 } }]),
        ...invalidBody.map((route) => [route, { body: {} }]),
        ...invalidParams.map(([route, params]) => [route, { params }])
    ];
    return cases.map(([route, options]) => singleRequest(`validação ${routeKey(route)}`, route, {
        ...options, cookie, expectedStatus: 400
    }));
}

function editionInput(catalog) {
    return {
        brazilianPublisherId: catalog.publisherId,
        coverTypeId: catalog.coverTypeId,
        formatId: catalog.formatId,
        paperIds: [catalog.paperId],
        chronologicalNumber: 1,
        brazilPublicationStatus: 'Em andamento'
    };
}

function volumeInput(coverAssetId) {
    return { number: 1, coverAssetId, releaseDatePrecision: 'Ano', releaseYear: 2025 };
}

function notFoundScenarios(cookie, catalog) {
    const cases = [
        [admin.role, { params: { id: noUuid }, body: { role: adminRole } }],
        [admin.options, { params: { category: 'categoria-ausente-da-fixture' } }],
        [admin.createOption, { body: { category: 'categoria-ausente-da-fixture', label: 'Opção sintética' } }],
        [admin.updateOption, { body: { active: false } }],
        [admin.deleteOption],
        [admin.deleteCover],
        [admin.workSlug],
        [admin.editionNumber],
        [admin.volumeNumber],
        [admin.createEdition, { body: editionInput(catalog) }],
        [admin.editions],
        [admin.createVolume, { body: volumeInput(noUuid) }],
        [admin.volumes],
        [admin.workVisibility, { body: { visibility: 'Privado' } }],
        [admin.work],
        [admin.updateWork, { body: { synopsis: 'Sinopse sintética.' } }],
        [admin.deleteWork],
        [admin.edition],
        [admin.updateEdition, { body: { brazilPublicationStatus: 'Completa' } }],
        [admin.deleteEdition],
        [admin.editionVisibility, { body: { visibility: 'Privado' } }],
        [admin.volume],
        [admin.updateVolume, { body: { synopsis: 'Sinopse sintética.' } }],
        [admin.deleteVolume]
    ];
    return cases.map(([route, options]) => singleRequest(`ausente ${routeKey(route)}`, route, {
        ...options, cookie, expectedStatus: 404
    }));
}

function ruleScenarios({ users, catalog }) {
    const cookie = users.admin.cookie;
    return [
        singleRequest('alteração do próprio perfil administrativo', admin.role, {
            params: { id: users.admin.id }, body: { role: adminRole }, cookie, expectedStatus: 403
        }),
        singleRequest('criação de classificação controlada', admin.createOption, {
            body: { category: managedCategory, label: 'Gênero sintético' }, cookie, expectedStatus: 403
        }),
        singleRequest('edição de classificação controlada', admin.updateOption, {
            params: { id: catalog.typeId }, body: { label: 'Tipo sintético' }, cookie, expectedStatus: 403
        }),
        singleRequest('exclusão de classificação controlada', admin.deleteOption, {
            params: { id: catalog.typeId }, cookie, expectedStatus: 403
        })
    ];
}

function asAdmin(request, cookie) {
    return (route, expectedStatus, options = {}) => send(request, route, { ...options, expectedStatus, cookie });
}

function roleScenario({ users, prisma }) {
    return scenario('conceder e remover perfil de conta sintética', admin.role, async ({ request }) => {
        const username = `carga-${randomUUID()}`;
        const { id } = await prisma.user.create({
            data: { username, email: `${username}@fixture.invalid`, passwordHash: 'sem-login', status: 'Ativada' },
            select: { id: true }
        });
        const call = asAdmin(request, users.admin.cookie);
        try {
            for (const role of [adminRole, memberRole]) {
                const { body } = await call(admin.role, 200, { params: { id }, body: { role } });
                assert.equal(body.user.role, role);
            }
        } finally {
            await prisma.user.delete({ where: { id } });
        }
    });
}

function optionScenario({ users }) {
    return scenario('criar, atualizar e excluir opção', admin.createOption, async ({ request }) => {
        const call = asAdmin(request, users.admin.cookie);
        const label = `Editora sintética ${randomUUID()}`;
        const optionInput = { category: editableCategory, label };
        const { body } = await call(admin.createOption, 201, { body: optionInput });
        const { id } = body.value;
        await call(admin.createOption, 409, { body: optionInput });
        const { body: updated } = await call(admin.updateOption, 200, { params: { id }, body: { active: false } });
        assert.equal(updated.value.active, false);
        await call(admin.deleteOption, 200, { params: { id } });
    }, [admin.updateOption, admin.deleteOption]);
}

async function uploadCover(call) {
    const { body } = await call(admin.importCover, 201, { body: coverInput });
    return body.asset.id;
}

function coverScenario({ users }) {
    return scenario('importar e excluir capa pendente', admin.importCover, async ({ request }) => {
        const call = asAdmin(request, users.admin.cookie);
        const assetId = await uploadCover(call);
        await call(admin.deleteCover, 204, { params: { assetId } });
    }, [admin.deleteCover]);
}

function workInput(catalog, coverAssetId) {
    const title = `Obra sintética ${randomUUID()}`;
    return {
        title,
        romanizedTitle: title,
        synopsis: 'Sinopse sintética para o teste de carga.',
        typeId: catalog.typeId,
        originalPublicationStatus: 'Em andamento',
        authors: [{ authorId: catalog.authorId, roles: ['História e Arte'] }],
        coverAssetId
    };
}

async function catalogVisibility(call, workId, editionId) {
    const work = { params: { id: workId } };
    const edition = { params: { id: editionId } };
    const publicData = { visibility: 'Público' };
    const privateData = { visibility: 'Privado' };
    await call(admin.editionVisibility, 409, { ...edition, body: publicData });
    await call(admin.workVisibility, 200, { ...work, body: publicData });
    await call(admin.deleteEdition, 409, edition);
    const { body } = await call(admin.editionVisibility, 200, { ...edition, body: privateData });
    assert.equal(body.edition.visibility, 'Privado');
    await call(admin.workVisibility, 200, { ...work, body: privateData });
}

function catalogScenario({ users, catalog }) {
    return scenario('editar e remover obra, edição e volume', admin.createWork, async ({ request }) => {
        const call = asAdmin(request, users.admin.cookie);
        const workAsset = await uploadCover(call);
        const { body: { work } } = await call(admin.createWork, 201, { body: workInput(catalog, workAsset) });
        const { body: { edition } } = await call(admin.createEdition, 201, {
            params: { workId: work.id }, body: editionInput(catalog)
        });
        const volumeAsset = await uploadCover(call);
        const { body: { volume } } = await call(admin.createVolume, 201, {
            params: { editionId: edition.id }, body: volumeInput(volumeAsset)
        });

        await call(admin.updateWork, 200, { params: { id: work.id }, body: { synopsis: 'Sinopse revisada.' } });
        await call(admin.updateEdition, 200, { params: { id: edition.id }, body: { brazilPublicationStatus: 'Completa' } });
        await call(admin.updateVolume, 200, { params: { id: volume.id }, body: { pages: 176 } });
        await call(admin.deleteCover, 404, { params: { assetId: volumeAsset } });
        await catalogVisibility(call, work.id, edition.id);
        await call(admin.deleteVolume, 200, { params: { id: volume.id } });
        await call(admin.deleteEdition, 200, { params: { id: edition.id } });
        await call(admin.deleteWork, 200, { params: { id: work.id } });
    }, [
        admin.importCover, admin.deleteCover, admin.createEdition, admin.createVolume, admin.updateWork,
        admin.updateEdition, admin.updateVolume, admin.workVisibility, admin.editionVisibility,
        admin.deleteVolume, admin.deleteEdition, admin.deleteWork
    ]);
}

function createScenarios(fixtures) {
    const { users, catalog } = fixtures;
    return [
        ...readScenarios(users, catalog),
        roleScenario(fixtures),
        optionScenario(fixtures),
        coverScenario(fixtures),
        catalogScenario(fixtures),
        ...authorizationScenarios(users.member),
        ...validationScenarios(users.admin.cookie),
        ...notFoundScenarios(users.admin.cookie, catalog),
        ...ruleScenarios(fixtures)
    ];
}

module.exports = { routes, createScenarios };
