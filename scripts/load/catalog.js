const assert = require('node:assert/strict');
const { URLSearchParams } = require('node:url');

const publicPrefix = '/api/public';
const personalPrefix = '/api/users/me';
const pg = 'PostgreSQL';
const cover = 'metadados e URL pública da capa, sem download';
const pagination = 'page, limit';
const personalAuth = 'Cookie de sessão ativa';
const optionalAuth = 'Cookie de sessão opcional. Para conteúdo +18, conta maior de idade com preferência ativa ou atribuição de administrador';
const listOrder = `${pagination}, sortBy, order`;
const batchInput = 'addVolumeIds, removeVolumeIds (JSON)';
const editionContext = 'slug, editionNumber (caminho)';
const editionDetails = `${pagination}, all (consulta)`;
const absentId = 2147483647;
const absentSlug = 'carga-comanga-inexistente';

function publicRoute(path, parameters, dependencies = [pg, cover]) {
    return { method: 'GET', path: `${publicPrefix}${path}`, auth: optionalAuth, parameters: parameters ? [parameters] : [], dependencies };
}

function personalRoute(method, path, parameters, dependencies = [pg]) {
    return { method, path: `${personalPrefix}${path}`, auth: personalAuth, parameters: [parameters], dependencies };
}

const publicRoutes = {
    options: publicRoute('/catalog-options', null, [pg]),
    calendar: publicRoute('/calendar', `${pagination}, year, month, term, brazilianPublisherId, order (consulta)`),
    works: publicRoute('/works', `${listOrder}, term, typeId, country, demographics, genreIds, originalPublisherId, serializationMagazineId, originalPublicationStatus, originalPublicationStartYear, originalPublicationEndYear (consulta)`),
    work: publicRoute('/works/:slug', 'slug (caminho)'),
    author: publicRoute('/authors/:authorId/works', `authorId, slug do autor (caminho). ${listOrder} (consulta)`),
    editions: publicRoute('/editions', `${listOrder}, term, brazilianPublisherId, formatId, coverTypeId, chronologicalNumber, brazilPublicationStatus, brazilPublicationStartYear, brazilPublicationEndYear (consulta)`),
    edition: publicRoute('/editions/:editionId', `editionId (caminho). ${editionDetails}`),
    volume: publicRoute('/volumes/:volumeId', 'volumeId (caminho)'),
    contextualEdition: publicRoute('/works/:slug/editions/:editionNumber', `${editionContext}. ${editionDetails}`),
    contextualVolume: publicRoute('/works/:slug/editions/:editionNumber/volumes/:volumeNumber', 'slug, editionNumber, volumeNumber (caminho)')
};

const personalRoutes = {
    collection: personalRoute('GET', '/collection', `${pagination}, term, status, brazilianPublisherId, order (consulta)`, [pg, cover]),
    wishlist: personalRoute('GET', '/wishlist', `${pagination}, term, brazilianPublisherId, order (consulta)`, [pg, cover]),
    selection: personalRoute('GET', '/collection/editions/:editionId', `editionId (caminho). ${editionDetails}`, [pg, cover]),
    syncOwned: personalRoute('PUT', '/collection/editions/:editionId', `editionId (caminho). ${batchInput}`),
    syncWanted: personalRoute('PUT', '/wishlist/editions/:editionId', `editionId (caminho). ${batchInput}`),
    syncRead: personalRoute('PUT', '/reading/editions/:editionId', `editionId (caminho). ${batchInput}`),
    putOwned: personalRoute('PUT', '/collection/volumes/:volumeId', 'volumeId (caminho)'),
    patchRead: personalRoute('PATCH', '/collection/volumes/:volumeId', 'volumeId (caminho). read (JSON)'),
    deleteOwned: personalRoute('DELETE', '/collection/volumes/:volumeId', 'volumeId (caminho)'),
    putWanted: personalRoute('PUT', '/wishlist/volumes/:volumeId', 'volumeId (caminho)'),
    deleteWanted: personalRoute('DELETE', '/wishlist/volumes/:volumeId', 'volumeId (caminho)')
};

function requestPath(route, params = {}, query) {
    const path = route.path.replace(/:(\w+)/g, (_, key) => {
        assert.ok(Object.hasOwn(params, key), `Parâmetro de caminho ausente: ${key}`);
        return encodeURIComponent(params[key]);
    });
    return query ? `${path}?${new URLSearchParams(query)}` : path;
}

function scenario(route, name, config = {}) {
    const { status = 200, params, query, cookie, body, verify, prepare, coverageOnly = false } = config;
    return {
        name,
        endpoint: `${route.method} ${route.path}`,
        coverageOnly,
        async run(context) {
            const sessionCookie = prepare ? await prepare(context) : cookie;
            const response = await context.request({
                method: route.method, path: requestPath(route, params, query),
                body, cookie: sessionCookie, expectedStatus: status
            });
            if (verify && response.status === status) await verify(response.body, context);
        }
    };
}

function checkPage(body, key, limit) {
    assert.ok(Array.isArray(body[key]) && body[key].length > 0 && body[key].length <= limit,
        `Página de ${key} fora do tamanho esperado`);
    assert.equal(body.pagination.limit, limit);
}

function publicListCases(catalog, member) {
    const page = { page: 2, limit: 5 };
    return [
        scenario(publicRoutes.options, 'public.opcoes.sucesso', {
            verify: body => assert.ok(body.options.workTypes.some(option => option.id === catalog.typeId))
        }),
        scenario(publicRoutes.calendar, 'public.calendario.sucesso', {
            cookie: member.cookie,
            query: { year: catalog.releaseYear, month: catalog.releaseMonth, brazilianPublisherId: catalog.publisherId, limit: 5 },
            verify(body) {
                checkPage(body, 'volumes', 5);
                assert.ok(body.volumes.every(volume => typeof volume.personal?.owned === 'boolean'));
            }
        }),
        scenario(publicRoutes.calendar, 'public.calendario.mes-invalido', { query: { month: 13 }, status: 400 }),
        scenario(publicRoutes.works, 'public.obras.busca-e-filtros', {
            query: { ...page, term: 'Carga CoManga', typeId: catalog.typeId, country: 'Japão', genreIds: [catalog.genreId, catalog.otherGenreId], demographics: 'Shonen' },
            verify: body => checkPage(body, 'works', 5)
        }),
        scenario(publicRoutes.works, 'public.obras.limite-invalido', { query: { limit: 51 }, status: 400 }),
        scenario(publicRoutes.author, 'public.autor.obras-paginadas', {
            params: { authorId: catalog.authorSlug }, query: page,
            verify(body) {
                assert.equal(body.author.slug, catalog.authorSlug);
                checkPage(body, 'works', 5);
            }
        }),
        scenario(publicRoutes.author, 'public.autor.inexistente', { params: { authorId: absentSlug }, status: 404 }),
        scenario(publicRoutes.author, 'public.autor.slug-invalido', { params: { authorId: 'autor inválido' }, status: 400 }),
        scenario(publicRoutes.editions, 'public.edicoes.busca-e-filtros', {
            query: { ...page, term: 'Carga CoManga', brazilianPublisherId: catalog.publisherId, formatId: catalog.formatId, coverTypeId: catalog.coverTypeId, brazilPublicationStartYear: catalog.releaseYear },
            verify: body => checkPage(body, 'editions', 5)
        }),
        scenario(publicRoutes.editions, 'public.edicoes.ordenacao-invalida', { query: { sortBy: 'invalido' }, status: 400 })
    ];
}

function publicDetailCases(catalog, users) {
    const { workSlug, adultWorkSlug, editionId, editionNumber, volumeNumber, volumeIds: [volumeId] } = catalog;
    const workParams = { slug: workSlug };
    const contextualEdition = { ...workParams, editionNumber };
    const contextualVolume = { ...contextualEdition, volumeNumber };
    const adultParams = { slug: adultWorkSlug };
    const editionVerify = body => assert.equal(body.edition.id, editionId);
    const volumeVerify = body => assert.equal(body.volume.id, volumeId);
    return [
        scenario(publicRoutes.work, 'public.obra.detalhe-com-sessao', {
            params: workParams, cookie: users.member.cookie,
            verify(body) {
                assert.equal(body.work.slug, workSlug);
                assert.ok(body.work.personal.ownedCount >= 1);
            }
        }),
        scenario(publicRoutes.work, 'public.obra.inexistente', { params: { slug: absentSlug }, status: 404 }),
        scenario(publicRoutes.work, 'public.obra.adulta-oculta-visitante', { params: adultParams, status: 404 }),
        scenario(publicRoutes.work, 'public.obra.adulta-permitida-administrador', {
            params: adultParams, cookie: users.admin.cookie,
            verify: body => assert.equal(body.work.slug, adultWorkSlug)
        }),
        scenario(publicRoutes.edition, 'public.edicao.detalhe', {
            params: { editionId }, query: { limit: 5 }, verify: editionVerify
        }),
        scenario(publicRoutes.edition, 'public.edicao.inexistente', { params: { editionId: absentId }, status: 404 }),
        scenario(publicRoutes.edition, 'public.edicao.id-invalido', { params: { editionId: 0 }, status: 400 }),
        scenario(publicRoutes.volume, 'public.volume.detalhe', { params: { volumeId }, verify: volumeVerify }),
        scenario(publicRoutes.volume, 'public.volume.inexistente', { params: { volumeId: absentId }, status: 404 }),
        scenario(publicRoutes.volume, 'public.volume.id-invalido', { params: { volumeId: 0 }, status: 400 }),
        scenario(publicRoutes.contextualEdition, 'public.edicao.por-obra-e-numero', {
            params: contextualEdition, query: { all: 'true' }, cookie: users.member.cookie, verify: editionVerify
        }),
        scenario(publicRoutes.contextualEdition, 'public.edicao.numero-inexistente', {
            params: { ...contextualEdition, editionNumber: absentId }, status: 404
        }),
        scenario(publicRoutes.contextualEdition, 'public.edicao.numero-invalido', {
            params: { ...contextualEdition, editionNumber: 0 }, status: 400
        }),
        scenario(publicRoutes.contextualVolume, 'public.volume.por-obra-edicao-e-numero', {
            params: contextualVolume, cookie: users.member.cookie, verify: volumeVerify
        }),
        scenario(publicRoutes.contextualVolume, 'public.volume.numero-inexistente', {
            params: { ...contextualVolume, volumeNumber: absentId }, status: 404
        }),
        scenario(publicRoutes.contextualVolume, 'public.volume.numero-invalido', {
            params: { ...contextualVolume, volumeNumber: -1 }, status: 400
        })
    ];
}

function personalReadCases(catalog, cookie) {
    const query = { term: 'Carga', brazilianPublisherId: catalog.publisherId, limit: 5 };
    return [
        scenario(personalRoutes.collection, 'pessoal.estante.filtrada', {
            query, cookie, verify: body => checkPage(body, 'works', 5)
        }),
        scenario(personalRoutes.collection, 'pessoal.estante.pagina-invalida', { query: { page: 0 }, cookie, status: 400 }),
        scenario(personalRoutes.wishlist, 'pessoal.desejos.filtrados', {
            query, cookie, verify(body) {
                checkPage(body, 'volumes', 5);
                assert.ok(body.totals.volumes >= 1);
            }
        }),
        scenario(personalRoutes.wishlist, 'pessoal.desejos.limite-invalido', { query: { limit: 51 }, cookie, status: 400 }),
        scenario(personalRoutes.selection, 'pessoal.edicao.selecao', {
            params: { editionId: catalog.editionId }, query: { limit: 5 }, cookie,
            verify(body) {
                assert.equal(body.edition.id, catalog.editionId);
                checkPage(body, 'volumes', 5);
                assert.ok(body.volumes[0].owned);
                assert.ok(body.volumes[1].wished);
            }
        }),
        scenario(personalRoutes.selection, 'pessoal.edicao.inexistente', {
            params: { editionId: absentId }, cookie, status: 404
        })
    ];
}

function batch(addVolumeIds = [], removeVolumeIds = []) {
    return { addVolumeIds, removeVolumeIds };
}

function personalBatchCases(fixtures, cookie) {
    const { catalog } = fixtures;
    const [owned, , newOwned, , , , newWanted, unowned] = catalog.volumeIds;
    const edition = { params: { editionId: catalog.editionId }, cookie };
    return [
        scenario(personalRoutes.syncOwned, 'pessoal.edicao.adicionar-a-estante', { ...edition, body: batch([newOwned]), prepare: prepareVolume(fixtures, newOwned) }),
        scenario(personalRoutes.syncOwned, 'pessoal.edicao.lote-duplicado', { ...edition, body: batch([owned], [owned]), status: 400 }),
        scenario(personalRoutes.syncWanted, 'pessoal.edicao.adicionar-aos-desejos', { ...edition, body: batch([newWanted]), prepare: prepareVolume(fixtures, newWanted) }),
        scenario(personalRoutes.syncWanted, 'pessoal.edicao.desejar-volume-proprio', { ...edition, body: batch([owned]), status: 409 }),
        scenario(personalRoutes.syncRead, 'pessoal.edicao.marcar-como-lido', { ...edition, body: batch([owned]), prepare: prepareVolume(fixtures, owned, 'Owned') }),
        scenario(personalRoutes.syncRead, 'pessoal.edicao.ler-volume-fora-da-estante', { ...edition, body: batch([unowned]), status: 404 })
    ];
}

function prepareVolume(fixtures, volumeId, state) {
    const usersByWorker = new Map();
    return async function prepare(context) {
        const { workerId } = context;
        if (!usersByWorker.has(workerId)) usersByWorker.set(workerId, await fixtures.createUser());
        const { id: userId, cookie } = usersByWorker.get(workerId);
        if (state) {
            const data = { state, read: state === 'Owned' ? false : null };
            await fixtures.prisma.userVolume.upsert({
                where: { userId_volumeId: { userId, volumeId } }, update: data,
                create: { userId, volumeId, ...data }
            });
        } else {
            await fixtures.prisma.userVolume.deleteMany({ where: { userId, volumeId } });
        }
        context.userId = userId;
        return cookie;
    };
}

function deleteVolumeCase(route, name, fixtures, volumeId, state) {
    const prepare = prepareVolume(fixtures, volumeId, state);
    return scenario(route, name, {
        params: { volumeId }, status: 204, prepare,
        async verify(_body, { phase, userId }) {
            if (phase !== 'coverage') return;
            const remaining = await fixtures.prisma.userVolume.count({ where: { userId, volumeId } });
            assert.equal(remaining, 0);
        }
    });
}

function personalVolumeCases(fixtures, cookie) {
    const [owned, , newOwned, newWanted, removeOwned, removeWanted, , unowned] = fixtures.catalog.volumeIds;
    return [
        scenario(personalRoutes.putOwned, 'pessoal.volume.adicionar-a-estante', { params: { volumeId: newOwned }, prepare: prepareVolume(fixtures, newOwned), verify: body => assert.equal(body.owned, true) }),
        scenario(personalRoutes.putOwned, 'pessoal.volume.inexistente', { params: { volumeId: absentId }, cookie, status: 404 }),
        scenario(personalRoutes.patchRead, 'pessoal.volume.marcar-como-lido', { params: { volumeId: owned }, body: { read: true }, prepare: prepareVolume(fixtures, owned, 'Owned'), verify: body => assert.equal(body.read, true) }),
        scenario(personalRoutes.patchRead, 'pessoal.volume.marcar-fora-da-estante', { params: { volumeId: unowned }, body: { read: true }, cookie, status: 404 }),
        scenario(personalRoutes.patchRead, 'pessoal.volume.leitura-invalida', { params: { volumeId: owned }, body: { read: 'true' }, cookie, status: 400 }),
        deleteVolumeCase(personalRoutes.deleteOwned, 'pessoal.volume.remover-da-estante', fixtures, removeOwned, 'Owned'),
        scenario(personalRoutes.deleteOwned, 'pessoal.volume.remover-id-invalido-da-estante', { params: { volumeId: 0 }, cookie, status: 400 }),
        scenario(personalRoutes.putWanted, 'pessoal.volume.adicionar-aos-desejos', { params: { volumeId: newWanted }, prepare: prepareVolume(fixtures, newWanted), verify: body => assert.equal(body.wished, true) }),
        scenario(personalRoutes.putWanted, 'pessoal.volume.desejar-volume-proprio', { params: { volumeId: owned }, cookie, status: 409 }),
        deleteVolumeCase(personalRoutes.deleteWanted, 'pessoal.volume.remover-dos-desejos', fixtures, removeWanted, 'Wanted'),
        scenario(personalRoutes.deleteWanted, 'pessoal.volume.remover-id-invalido-dos-desejos', { params: { volumeId: 0 }, cookie, status: 400 })
    ];
}

function createScenarios(fixtures) {
    const { catalog, users } = fixtures;
    const unauthorized = Object.entries(personalRoutes).map(([name, route]) => scenario(route, `pessoal.${name}.sem-sessao`, {
        params: { editionId: catalog.editionId, volumeId: catalog.volumeIds[0] }, status: 401, coverageOnly: true
    }));
    return [
        ...publicListCases(catalog, users.member),
        ...publicDetailCases(catalog, users),
        ...personalReadCases(catalog, users.member.cookie),
        ...personalBatchCases(fixtures, users.member.cookie),
        ...personalVolumeCases(fixtures, users.member.cookie),
        ...unauthorized
    ];
}

module.exports = { routes: [...Object.values(publicRoutes), ...Object.values(personalRoutes)], createScenarios };
