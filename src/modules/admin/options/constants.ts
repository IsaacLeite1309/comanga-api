const DUPLICATE_OPTION_MESSAGE = 'Essa lista já tem esse valor cadastrado!';
const OPTION_IN_USE_MESSAGE = 'Esse valor está vinculado a um mangá, não pode ser excluído!';
const COUNTRY_DEPENDENCY_REQUIRED_MESSAGE = 'Selecione ao menos um país de origem relacionado.';
const SYSTEM_MANAGED_CREATE_MESSAGE = 'Os valores dessa lista são controlados pelo sistema e não podem ser criados.';
const SYSTEM_MANAGED_DELETE_MESSAGE = 'Esse valor é controlado pelo sistema e não pode ser excluído.';
const SYSTEM_MANAGED_UPDATE_MESSAGE = 'Esse valor é controlado pelo sistema: só é possível ativá-lo ou desativá-lo.';
const NOT_REORDERABLE_CATEGORY_MESSAGE = 'Essa lista não permite reordenação manual.';
const INVALID_REORDER_VALUES_MESSAGE = 'Um ou mais valores informados não pertencem a essa lista.';
const MANAGEABLE_OPTION_CATEGORY_SLUGS = new Set([
    'autores',
    'tipos-obra',
    'generos',
    'editoras-originais',
    'revistas-serializacao',
    'editoras-brasileiras',
    'tipos-edicao',
    'tipos-capa',
    'formatos-fisicos'
]);
const LISTABLE_OPTION_CATEGORY_SLUGS = new Set([
    ...MANAGEABLE_OPTION_CATEGORY_SLUGS,
    'paises-origem'
]);

export {
    COUNTRY_DEPENDENCY_REQUIRED_MESSAGE,
    DUPLICATE_OPTION_MESSAGE,
    INVALID_REORDER_VALUES_MESSAGE,
    NOT_REORDERABLE_CATEGORY_MESSAGE,
    SYSTEM_MANAGED_CREATE_MESSAGE,
    SYSTEM_MANAGED_DELETE_MESSAGE,
    SYSTEM_MANAGED_UPDATE_MESSAGE,
    LISTABLE_OPTION_CATEGORY_SLUGS,
    MANAGEABLE_OPTION_CATEGORY_SLUGS,
    OPTION_IN_USE_MESSAGE
};
