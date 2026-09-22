const AUTHOR_DUPLICATED_MESSAGE = 'Autor duplicado!';
const WORK_DUPLICATED_MESSAGE = 'Obra já cadastrada!';
const REQUIRED_WORK_FIELDS_MESSAGE = 'Preencha os campos obrigatórios da Obra.';
const INVALID_DOMAIN_REFERENCE_MESSAGE = 'Um ou mais valores selecionados são inválidos.';
const WORK_VISIBILITY_VALUES = ['Privado', 'Público'] as const;
const WORK_SORT_FIELDS = ['title', 'author', 'country', 'type', 'editions', 'visibility'] as const;
const AUTHOR_ROLE_VALUES = ['História e Arte', 'História', 'Arte', 'Criador Original', 'História Original', 'Ilustrador', 'Design de Personagens'] as const;
const AUTHOR_ROLE_PRIORITY_VALUES = ['Criador Original', 'História Original', 'História e Arte', 'História', 'Arte', 'Ilustrador', 'Design de Personagens'] as const;
const WORK_COUNTRY_VALUES = ['Japão', 'Coreia do Sul', 'China', 'Taiwan'] as const;
const ORIGINAL_PUBLICATION_STATUS_VALUES = ['Completa', 'Em andamento', 'Em hiato', 'Cancelada'] as const;
const WORK_DEMOGRAPHY_VALUES = ['Shonen', 'Shoujo', 'Seinen', 'Josei', 'Kodomo'] as const;
const WORK_DOMAIN_CATEGORIES = {
    typeId: 'tipos-obra',
    originalPublishers: 'editoras-originais',
    authorId: 'autores',
    genreIds: 'generos',
    magazineIds: 'revistas-serializacao'
} as const;
const COUNTRY_CATEGORY_SLUG = 'paises-origem';
const WORK_FORM_OPTION_CATEGORIES = {
    authors: 'autores',
    workTypes: 'tipos-obra',
    genres: 'generos',
    magazines: 'revistas-serializacao',
    originalPublishers: 'editoras-originais'
} as const;
const EDITION_FORM_OPTION_CATEGORIES = {
    brazilianPublishers: 'editoras-brasileiras',
    coverTypes: 'tipos-capa',
    formats: 'formatos-fisicos',
    papers: 'miolos'
} as const;
const EDITION_VISIBILITY_VALUES = ['Privado', 'Público'] as const;
const EDITION_PUBLICATION_STATUS_VALUES = ['Completa', 'Em andamento', 'Em hiato', 'Cancelada'] as const;
const EDITION_DUPLICATED_MESSAGE = 'Essa Obra já possui uma Edição com esse número cronológico!';
const PRIVATE_WORK_PUBLIC_EDITION_MESSAGE = 'Essa Edição está vinculada a uma Obra privada, não pode ser publicada!';
// A capa da Edição é derivada exclusivamente do Volume com este número na mesma Edição.
const EDITION_COVER_SOURCE_VOLUME_NUMBER = 1;
const EDITION_WITHOUT_COVER_SOURCE_MESSAGE = 'Essa Edição não possui o Volume 1 com capa interna válida, não pode ser publicada!';
const PUBLIC_EDITION_COVER_SOURCE_MESSAGE = 'Esse é o Volume 1 de uma Edição pública: renumerá-lo deixaria a Edição sem capa!';
const PUBLIC_EDITION_DELETE_MESSAGE = 'Essa Edição está pública, não pode ser excluída!';
const WORK_WITH_EDITIONS_DELETE_MESSAGE = 'Essa Obra possui Edições vinculadas, não pode ser excluída!';
const EDITION_WITH_VOLUMES_DELETE_MESSAGE = 'Essa Edição possui Volumes vinculados, não pode ser excluída!';
const VOLUME_DUPLICATED_MESSAGE = 'Um volume desta edição com esse mesmo número já foi cadastrado anteriormente!';
const PUBLIC_VOLUME_DELETE_MESSAGE = 'Essa Obra está pública, não pode ser excluída!';
const VOLUME_PRICE_CURRENCY_VALUES = ['R$', 'CR$', 'Cr$', 'NCz$', 'Cz$'] as const;
const VOLUME_RELEASE_PRECISION_VALUES = ['Completa', 'Mes e ano', 'Ano'] as const;
const COUNTRY_DEPENDENT_CATEGORY_SLUGS = new Set([
    'autores',
    'tipos-obra',
    'revistas-serializacao',
    'editoras-originais'
]);
export {
    AUTHOR_DUPLICATED_MESSAGE,
    WORK_DUPLICATED_MESSAGE,
    REQUIRED_WORK_FIELDS_MESSAGE,
    INVALID_DOMAIN_REFERENCE_MESSAGE,
    WORK_VISIBILITY_VALUES,
    WORK_SORT_FIELDS,
    AUTHOR_ROLE_VALUES,
    AUTHOR_ROLE_PRIORITY_VALUES,
    WORK_COUNTRY_VALUES,
    ORIGINAL_PUBLICATION_STATUS_VALUES,
    WORK_DEMOGRAPHY_VALUES,
    WORK_DOMAIN_CATEGORIES,
    COUNTRY_CATEGORY_SLUG,
    WORK_FORM_OPTION_CATEGORIES,
    EDITION_FORM_OPTION_CATEGORIES,
    EDITION_VISIBILITY_VALUES,
    EDITION_PUBLICATION_STATUS_VALUES,
    EDITION_DUPLICATED_MESSAGE,
    PRIVATE_WORK_PUBLIC_EDITION_MESSAGE,
    EDITION_COVER_SOURCE_VOLUME_NUMBER,
    EDITION_WITHOUT_COVER_SOURCE_MESSAGE,
    PUBLIC_EDITION_COVER_SOURCE_MESSAGE,
    PUBLIC_EDITION_DELETE_MESSAGE,
    WORK_WITH_EDITIONS_DELETE_MESSAGE,
    EDITION_WITH_VOLUMES_DELETE_MESSAGE,
    VOLUME_DUPLICATED_MESSAGE,
    PUBLIC_VOLUME_DELETE_MESSAGE,
    VOLUME_PRICE_CURRENCY_VALUES,
    VOLUME_RELEASE_PRECISION_VALUES,
    COUNTRY_DEPENDENT_CATEGORY_SLUGS
};
