const { setTimeout: delay } = require('node:timers/promises');
process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test';
const request = require('supertest');
const bcrypt = require('bcrypt');

const db = require('../src/database');
const app = require('../src/app');
const prisma = require('../src/prisma');
const { createTestCover } = require('./helpers/cover');
const { PrismaMediaAssetRepository } = require('../src/modules/media/PrismaMediaAssetRepository');

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const prefix = `derived_cover_${runId}`;
const testEmailDomain = 'derived-cover-test.local';
const validPassword = 'SenhaForte123!';

jest.setTimeout(30000);

let adminCookie;
let optionId;
const editionOptionIds = {};
let workId;

async function createAdminSession() {
    const email = `${prefix}@${testEmailDomain}`;
    const passwordHash = await bcrypt.hash(validPassword, 10);
    await db.query(
        `INSERT INTO users (username, email, password_hash, status, nivel_acesso, birth_date)
         VALUES ($1, $2, $3, 'Ativada', 'Administrador', '2000-01-01')`,
        [prefix.slice(0, 50), email, passwordHash]
    );
    const response = await request(app).post('/api/auth/login').send({ email, password: validPassword });
    const cookies = response.headers['set-cookie'] || [];
    return cookies.find((cookie) => cookie.startsWith('comanga_session='));
}

async function createOption(categorySlug = 'tipos-obra') {
    const category = await db.query(
        'SELECT id FROM domain_option_categories WHERE slug = $1',
        [categorySlug]
    );
    const result = await db.query(
        'INSERT INTO domain_option_values (category_id, label) VALUES ($1, $2) RETURNING id',
        [category.rows[0].id, `${prefix}_${categorySlug}`]
    );
    return result.rows[0].id;
}

async function createWork(visibility = 'Público') {
    const result = await db.query(
        `INSERT INTO works (slug, title, romanized_title, synopsis, type_id, country, original_publication_status, cover_asset_id, visibility, atualizado_em)
         VALUES ($1::text, $1::text, $1::text, $1::text, $2, 'Japão', 'Completa', $3, $4, NOW()) RETURNING id`,
        [prefix, optionId, await createTestCover(db, prefix), visibility]
    );
    return result.rows[0].id;
}

async function createEdition(chronologicalNumber) {
    const response = await request(app)
        .post(`/api/admin/works/${workId}/editions`)
        .set('Cookie', adminCookie)
        .send({
            brazilianPublisherId: editionOptionIds.brazilianPublishers,
            coverTypeId: editionOptionIds.coverTypes,
            formatId: editionOptionIds.formats,
            paperIds: [editionOptionIds.papers],
            chronologicalNumber,
            brazilPublicationStatus: 'Completa'
        });
    return response;
}

async function createVolume(editionId, number, body = {}) {
    return request(app)
        .post(`/api/admin/editions/${editionId}/volumes`)
        .set('Cookie', adminCookie)
        .send({
            number,
            coverAssetId: await createTestCover(db, prefix),
            releaseDatePrecision: 'Ano',
            releaseYear: 2026,
            ...body
        });
}

function publish(editionId) {
    return request(app)
        .patch(`/api/admin/editions/${editionId}/visibility`)
        .set('Cookie', adminCookie)
        .send({ visibility: 'Público' });
}

describe('capas derivadas da Edição com banco real', () => {
it('resolve Edição e Volume administrativos pelos números dentro da Obra', async () => {
    const edition = (await createEdition(123)).body.edition;
    const volume = (await createVolume(edition.id, 1)).body.volume;
    const editionPath = `/api/admin/works/slug/${prefix}/editions/123`;
    const editionResult = await request(app).get(editionPath).set('Cookie', adminCookie);
    const volumeResult = await request(app).get(`${editionPath}/volumes/1`).set('Cookie', adminCookie);
    expect(editionResult.status).toBe(200);
    expect(editionResult.body.edition.id).toBe(edition.id);
    expect(volumeResult.status).toBe(200);
    expect(volumeResult.body.volume.id).toBe(volume.id);
    const wrongWork = await request(app).get('/api/admin/works/slug/obra-inexistente/editions/123').set('Cookie', adminCookie);
    const wrongVolume = await request(app).get(`${editionPath}/volumes/2`).set('Cookie', adminCookie);
    expect(wrongWork.status).toBe(404);
    expect(wrongVolume.status).toBe(404);
});
it('fixa Volume único no número 1 e bloqueia outros Volumes até a marcação ser retirada', async () => {
    const edition = (await createEdition(122)).body.edition;
    const single = await createVolume(edition.id, 0, { singleVolume: true });
    expect(single.status).toBe(201);
    expect(single.body.volume).toEqual(expect.objectContaining({ number: 1, singleVolume: true }));

    const blocked = await createVolume(edition.id, 2);
    expect(blocked.status).toBe(409);

    const unset = await request(app)
        .patch(`/api/admin/volumes/${single.body.volume.id}`)
        .set('Cookie', adminCookie)
        .send({ singleVolume: false });
    expect(unset.status).toBe(200);

    const second = await createVolume(edition.id, 2);
    expect(second.status).toBe(201);

    const reenabled = await request(app)
        .patch(`/api/admin/volumes/${single.body.volume.id}`)
        .set('Cookie', adminCookie)
        .send({ singleVolume: true });
    expect(reenabled.status).toBe(409);
});
beforeAll(async () => {
    adminCookie = await createAdminSession();
    optionId = await createOption();
    for (const [key, slug] of Object.entries({
        brazilianPublishers: 'editoras-brasileiras',
        coverTypes: 'tipos-capa',
        formats: 'formatos-fisicos',
        papers: 'miolos'
    })) {
        editionOptionIds[key] = await createOption(slug);
    }
    workId = await createWork();
});

afterAll(async () => {
    await db.query('DELETE FROM volumes WHERE edition_id IN (SELECT id FROM editions WHERE work_id = $1)', [workId]);
    await db.query('DELETE FROM editions WHERE work_id = $1', [workId]);
    await db.query('DELETE FROM works WHERE id = $1', [workId]);
    await db.query('DELETE FROM media_assets WHERE object_key LIKE $1', [`${prefix}/%`]);
    await db.query('DELETE FROM domain_option_values WHERE label LIKE $1', [`${prefix}%`]);
    await db.query('DELETE FROM users WHERE email LIKE $1', [`%@${testEmailDomain}`]);
});

describe('capa da Edição derivada do Volume 1', () => {
    it.each(Array.from({ length: 8 }, (_, bits) => bits))('persiste e limpa metadados opcionais da combinação %s', async (bits) => {
        const fields = {
            coverTypeId: bits & 1 ? editionOptionIds.coverTypes : null,
            formatId: bits & 2 ? editionOptionIds.formats : null,
            paperIds: bits & 4 ? [editionOptionIds.papers] : []
        };
        const created = await request(app).post(`/api/admin/works/${workId}/editions`)
            .set('Cookie', adminCookie).send({
                brazilianPublisherId: editionOptionIds.brazilianPublishers,
                chronologicalNumber: 200 + bits, brazilPublicationStatus: 'Completa', ...fields
            });
        expect(created.status).toBe(201);
        expect(created.body.edition).not.toHaveProperty('editionType');
        const stored = await prisma.edition.findUniqueOrThrow({
            where: { id: created.body.edition.id },
            include: { papers: { select: { paperId: true } } }
        });
        expect(stored).toEqual(expect.objectContaining({ coverTypeId: fields.coverTypeId, formatId: fields.formatId }));
        expect(stored.papers.map(({ paperId }) => paperId)).toEqual(fields.paperIds);
        const updated = await request(app).patch(`/api/admin/editions/${stored.id}`)
            .set('Cookie', adminCookie).send({ coverTypeId: null, formatId: null, paperIds: [] });
        expect(updated.status).toBe(200);
        expect(updated.body.edition).toEqual(expect.objectContaining({ coverType: null, format: null, papers: [] }));
    });

    it('remove colunas e categoria descartadas sem apagar o miolo', async () => {
        const columns = await db.query(`SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND ((table_name = 'works' AND column_name = 'original_volume_count')
                OR (table_name = 'editions' AND column_name = 'edition_type_id'))`);
        expect(columns.rows).toHaveLength(0);
        expect(await prisma.domainOptionCategory.findUnique({ where: { slug: 'tipos-edicao' } })).toBeNull();
        expect(await prisma.domainOptionCategory.findUnique({ where: { slug: 'miolos' } })).not.toBeNull();
        const response = await request(app).get('/api/admin/editions/form-options').set('Cookie', adminCookie);
        expect(response.status).toBe(200);
        expect(response.body.options).not.toHaveProperty('editionTypes');
        expect(response.body.options.papers).toEqual(expect.any(Array));
    });

    it('não persiste mais capa própria na Edição nem aceita o campo no contrato', async () => {
        const columns = await db.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'editions' AND column_name = 'cover_asset_id'
        `);
        expect(columns.rows).toHaveLength(0);

        const created = await createEdition(90);
        expect(created.status).toBe(201);
        expect(created.body.edition).toEqual(expect.objectContaining({
            coverAssetId: null,
            coverUrl: null,
            visibility: 'Privado'
        }));

        const rejected = await request(app)
            .patch(`/api/admin/editions/${created.body.edition.id}`)
            .set('Cookie', adminCookie)
            .send({ coverAssetId: await createTestCover(db, prefix) });
        expect(rejected.status).toBe(400);
    });

    it('usa a capa do Volume 1 mesmo com Volume 0 cadastrado e sem recorrer ao Volume 2', async () => {
        const edition = (await createEdition(91)).body.edition;
        const volumeZero = await createVolume(edition.id, 0);
        const volumeOne = await createVolume(edition.id, 1);
        await createVolume(edition.id, 2);

        const detail = await request(app)
            .get(`/api/admin/editions/${edition.id}`)
            .set('Cookie', adminCookie);

        expect(detail.body.edition.coverAssetId).toBe(volumeOne.body.volume.coverAssetId);
        expect(detail.body.edition.coverAssetId).not.toBe(volumeZero.body.volume.coverAssetId);
        expect(detail.body.edition.coverUrl).toBe(volumeOne.body.volume.coverUrl);
    });

    it('em Edição privada sem Volume 1 a capa fica ausente, sem cair no Volume 0 nem no 2', async () => {
        const edition = (await createEdition(92)).body.edition;
        await createVolume(edition.id, 0);
        await createVolume(edition.id, 2);

        const detail = await request(app)
            .get(`/api/admin/editions/${edition.id}`)
            .set('Cookie', adminCookie);

        expect(detail.body.edition).toEqual(expect.objectContaining({ coverAssetId: null, coverUrl: null }));
        expect(detail.body.edition.volumesCount).toBe(2);
    });

    it('não usa o Volume 1 de outra Edição da mesma Obra', async () => {
        const withCoverSource = (await createEdition(93)).body.edition;
        const withoutCoverSource = (await createEdition(94)).body.edition;
        await createVolume(withCoverSource.id, 1);

        const detail = await request(app)
            .get(`/api/admin/editions/${withoutCoverSource.id}`)
            .set('Cookie', adminCookie);

        expect(detail.body.edition.coverAssetId).toBeNull();
    });

    it('recusa publicar Edição sem Volume 1 e mantém a hierarquia privada', async () => {
        const edition = (await createEdition(95)).body.edition;
        await createVolume(edition.id, 0);

        const response = await publish(edition.id);

        expect(response.status).toBe(409);
        expect(response.body.error).toBe(
            'Essa Edição não possui o Volume 1 com capa interna válida, não pode ser publicada!'
        );
        const persisted = await db.query(
            `SELECT edition.visibility AS edition_visibility, volume.visibility AS volume_visibility
             FROM editions AS edition JOIN volumes AS volume ON volume.edition_id = edition.id
             WHERE edition.id = $1`,
            [edition.id]
        );
        expect(persisted.rows[0]).toEqual({ edition_visibility: 'Privado', volume_visibility: 'Privado' });
    });

    it('publica a Edição quando existe Volume 1 com capa e deixa esse Volume público na mesma transação', async () => {
        const edition = (await createEdition(96)).body.edition;
        const volumeOne = await createVolume(edition.id, 1);

        const response = await publish(edition.id);

        expect(response.status).toBe(200);
        expect(response.body.edition).toEqual(expect.objectContaining({
            visibility: 'Público',
            coverAssetId: volumeOne.body.volume.coverAssetId
        }));
        const persisted = await db.query('SELECT visibility FROM volumes WHERE id = $1', [volumeOne.body.volume.id]);
        expect(persisted.rows[0].visibility).toBe('Público');
    });

    it('recusa renumerar o Volume 1 de Edição pública e continua bloqueando a exclusão de Volume público', async () => {
        const edition = (await createEdition(97)).body.edition;
        const volumeOne = await createVolume(edition.id, 1);
        expect((await publish(edition.id)).status).toBe(200);

        const renumbered = await request(app)
            .patch(`/api/admin/volumes/${volumeOne.body.volume.id}`)
            .set('Cookie', adminCookie)
            .send({ number: 5 });
        const deleted = await request(app)
            .delete(`/api/admin/volumes/${volumeOne.body.volume.id}`)
            .set('Cookie', adminCookie);

        expect(renumbered.status).toBe(409);
        expect(deleted.status).toBe(409);
        const persisted = await db.query('SELECT number FROM volumes WHERE id = $1', [volumeOne.body.volume.id]);
        expect(persisted.rows[0].number).toBe(1);
    });

    it('preserva a capa do Volume na alteração parcial e recusa cadastro sem capa', async () => {
        const edition = (await createEdition(98)).body.edition;
        const created = await createVolume(edition.id, 1);

        const updated = await request(app)
            .patch(`/api/admin/volumes/${created.body.volume.id}`)
            .set('Cookie', adminCookie)
            .send({ pages: 320 });
        const withoutCover = await request(app)
            .post(`/api/admin/editions/${edition.id}/volumes`)
            .set('Cookie', adminCookie)
            .send({ number: 2, releaseDatePrecision: 'Ano', releaseYear: 2026 });

        expect(updated.status).toBe(200);
        expect(updated.body.volume.coverAssetId).toBe(created.body.volume.coverAssetId);
        expect(withoutCover.status).toBe(400);
    });

    it('mantém o ativo do Volume 1 fora do descarte enquanto estiver associado', async () => {
        const edition = (await createEdition(99)).body.edition;
        const volumeOne = await createVolume(edition.id, 1);
        const assetId = volumeOne.body.volume.coverAssetId;

        const claimed = await new PrismaMediaAssetRepository().claimRemoval(assetId);
        const persisted = await db.query('SELECT status FROM media_assets WHERE id = $1', [assetId]);

        expect(claimed).toEqual(expect.objectContaining({ id: assetId, attached: true }));
        expect(persisted.rows[0].status).toBe('Ativo');
        await expect(db.query('DELETE FROM media_assets WHERE id = $1', [assetId]))
            .rejects.toMatchObject({ code: '23503' });
    });
});

describe('concorrência da capa derivada', () => {
    it('revalida a renumeração após uma publicação concorrente', async () => {
        const edition = (await createEdition(120)).body.edition;
        const volume = (await createVolume(edition.id, 1)).body.volume;
        const client = await db.pool.connect();
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(9142026)');
        // A publicação já detém o lock; a API não pode validar sobre o estado privado antigo.
        const pending = request(app).patch(`/api/admin/volumes/${volume.id}`)
            .set('Cookie', adminCookie).send({ number: 2 }).then(response => response);
        try {
            await waitForBlockedCatalogWrite();
            await client.query("UPDATE editions SET visibility = 'Público' WHERE id = $1", [edition.id]);
            await client.query("UPDATE volumes SET visibility = 'Público' WHERE edition_id = $1", [edition.id]);
            await client.query('COMMIT');
            expect((await pending).status).toBe(409);
            const persisted = await prisma.volume.findUnique({ where: { id: volume.id } });
            expect(persisted.number).toBe(1);
        } finally {
            await client.query('ROLLBACK');
            client.release();
            await pending;
        }
    });
});

async function waitForBlockedCatalogWrite() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const waiting = await db.query(`SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND pid <> pg_backend_pid()`);
        if (waiting.rowCount > 0) return;
        await delay(10);
    }
    throw new Error('A escrita concorrente não chegou ao bloqueio esperado.');
}

describe('estado físico após a migration da capa derivada', () => {
    it('remove FK, índice único e gatilhos de capa da Edição sem apagar ativos em uso', async () => {
        const constraints = await db.query(`
            SELECT conname FROM pg_constraint WHERE conname = 'editions_cover_asset_id_fkey'
        `);
        const indexes = await db.query(`
            SELECT indexname FROM pg_indexes WHERE indexname = 'editions_cover_asset_id_key'
        `);
        const triggers = await db.query(`
            SELECT tgname FROM pg_trigger
            WHERE tgrelid = 'editions'::regclass AND NOT tgisinternal
        `);
        const lifecycle = await db.query(`
            SELECT prosrc FROM pg_proc
            WHERE proname IN ('validate_cover_attachment', 'discard_detached_cover', 'protect_discarded_cover')
        `);

        expect(constraints.rows).toHaveLength(0);
        expect(indexes.rows).toHaveLength(0);
        expect(triggers.rows.map((row) => row.tgname)).not.toEqual(
            expect.arrayContaining(['validate_cover_attachment', 'discard_detached_cover'])
        );
        expect(lifecycle.rows).toHaveLength(3);
        // As funções de ciclo de vida não podem mais consultar a tabela editions.
        lifecycle.rows.forEach((row) => expect(row.prosrc).not.toMatch(/FROM editions/));
        expect(lifecycle.rows.some((row) => /FROM works/.test(row.prosrc))).toBe(true);
        expect(lifecycle.rows.some((row) => /FROM volumes/.test(row.prosrc))).toBe(true);
    });
});
});
