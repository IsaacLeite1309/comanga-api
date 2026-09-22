const DUPLICATE_OPTION_MESSAGE = 'Essa lista já tem esse valor cadastrado!';
const OPTION_IN_USE_MESSAGE = 'Esse valor está vinculado a um mangá, não pode ser excluído!';
const COUNTRY_DEPENDENCY_REQUIRED_MESSAGE = 'Selecione ao menos um país de origem relacionado.';
const MANAGEABLE_OPTION_CATEGORY_SLUGS = new Set([
    'autores',
    'tipos-obra',
    'generos',
    'editoras-originais',
    'revistas-serializacao',
    'editoras-brasileiras',
    'tipos-edicao',
    'tipos-capa',
    'formatos-fisicos',
    'miolos'
]);
const LISTABLE_OPTION_CATEGORY_SLUGS = new Set([
    ...MANAGEABLE_OPTION_CATEGORY_SLUGS,
    'paises-origem'
]);

export {
    COUNTRY_DEPENDENCY_REQUIRED_MESSAGE,
    DUPLICATE_OPTION_MESSAGE,
    LISTABLE_OPTION_CATEGORY_SLUGS,
    MANAGEABLE_OPTION_CATEGORY_SLUGS,
    OPTION_IN_USE_MESSAGE
};
