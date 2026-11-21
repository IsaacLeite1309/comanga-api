const { createHash } = require('node:crypto');

const PUBLIC = 'Público';
const releaseYear = 2026;
const releaseMonth = 10;
const workSlug = 'carga-comanga-principal';
const authorSlug = 'carga-comanga-autor';

async function catalogOption(prisma, slug, label, code) {
    const category = await prisma.domainOptionCategory.findUniqueOrThrow({ where: { slug } });
    return prisma.domainOptionValue.create({ data: { categoryId: category.id, label, code } });
}

async function catalogOptions(prisma) {
    const [type, genre, otherGenre, paper] = await Promise.all([
        prisma.domainOptionValue.findFirstOrThrow({ where: { category: { slug: 'tipos-obra' }, code: 'manga' } }),
        prisma.domainOptionValue.findFirstOrThrow({ where: { category: { slug: 'generos' }, code: 'aventura' } }),
        prisma.domainOptionValue.findFirstOrThrow({ where: { category: { slug: 'generos' }, code: 'acao' } }),
        prisma.domainOptionValue.findFirstOrThrow({ where: { category: { slug: 'miolos' }, label: 'Papel' } })
    ]);
    const [author, publisher, format, coverType] = await Promise.all([
        catalogOption(prisma, 'autores', 'Autor sintético CoMangá', authorSlug),
        catalogOption(prisma, 'editoras-brasileiras', 'Editora sintética CoMangá'),
        catalogOption(prisma, 'formatos-fisicos', 'Formato sintético CoMangá'),
        catalogOption(prisma, 'tipos-capa', 'Capa sintética CoMangá')
    ]);
    return {
        typeId: type.id, authorId: author.id, publisherId: publisher.id,
        genreId: genre.id, otherGenreId: otherGenre.id, formatId: format.id, coverTypeId: coverType.id, paperId: paper.id
    };
}

function makeCover(objectKey) {
    return {
        create: {
            objectKey,
            provider: 'r2',
            format: 'webp',
            mimeType: 'image/webp',
            width: 10,
            height: 15,
            bytes: 10,
            checksum: createHash('sha256').update(objectKey).digest('hex'),
            status: 'Ativo'
        }
    };
}

function makeVolumes(slug, count) {
    return Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        coverAsset: makeCover(`carga/${slug}/volume-${index + 1}.webp`),
        visibility: PUBLIC,
        releaseYear,
        releaseMonth,
        releaseDay: index + 1
    }));
}

function createCatalogWork(prisma, options, { slug, title, count = 1, adultContent = false }) {
    return prisma.work.create({
        data: {
            slug, title, romanizedTitle: title, synopsis: 'Sinopse sintética para a carga local do catálogo.',
            type: { connect: { id: options.typeId } }, originalPublicationStatus: 'Completa',
            originalPublicationStartYear: 2015, originalPublicationEndYear: 2018,
            visibility: PUBLIC, adultContent, coverAsset: makeCover(`carga/${slug}/obra.webp`),
            authors: { create: { authorId: options.authorId, roles: { create: { role: 'História e Arte' } } } },
            genres: { create: [{ genreId: options.genreId }, { genreId: options.otherGenreId }] },
            demographics: { create: { demography: 'Shonen' } },
            editions: {
                create: {
                    chronologicalNumber: 1, brazilPublicationStatus: 'Completa', visibility: PUBLIC,
                    brazilianPublisherId: options.publisherId, formatId: options.formatId, coverTypeId: options.coverTypeId,
                    papers: { create: { paperId: options.paperId } },
                    volumes: { create: makeVolumes(slug, count) }
                }
            }
        },
        include: { editions: { include: { volumes: { orderBy: { number: 'asc' } } } } }
    });
}

async function createCatalogFixture(prisma) {
    const options = await catalogOptions(prisma);
    const main = await createCatalogWork(prisma, options, { slug: workSlug, title: 'Carga CoMangá principal', count: 8 });
    const adultWorkSlug = 'carga-comanga-restrita';
    await createCatalogWork(prisma, options, { slug: adultWorkSlug, title: 'Carga CoMangá restrita', adultContent: true });
    for (let number = 1; number <= 50; number++) {
        await createCatalogWork(prisma, options, { slug: `carga-comanga-serie-${number}`, title: `Carga CoMangá série ${number}` });
    }
    const [edition] = main.editions;
    return {
        ...options, workId: main.id, workSlug, adultWorkSlug, authorSlug, releaseYear, releaseMonth,
        editionId: edition.id, editionNumber: edition.chronologicalNumber, volumeNumber: edition.volumes[0].number,
        volumeIds: edition.volumes.map(volume => volume.id)
    };
}

async function seedPersonalCatalog(prisma, user, catalog) {
    const [owned, wished] = catalog.volumeIds;
    await prisma.userVolume.createMany({ data: [
        { userId: user.id, volumeId: owned, state: 'Owned', read: false },
        { userId: user.id, volumeId: wished, state: 'Wanted', read: null }
    ] });
}

module.exports = { createCatalogFixture, seedPersonalCatalog };
