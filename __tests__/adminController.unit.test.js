const prisma = {
    user: {
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn()
    },
    domainOptionCategory: {
        findUnique: jest.fn()
    },
    domainOptionValue: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
    },
    domainOptionValueDependency: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workAuthorRole: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workAuthor: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workGenre: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workDemography: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workSerializationMagazine: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    workOriginalPublisher: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
    },
    work: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn()
    },
    edition: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
    },
    volume: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn()
    },
    $transaction: jest.fn()
};

jest.mock('../src/prisma', () => prisma);

const adminController = require('../src/controllers/adminController');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res)
    };

    return res;
}

function makeReq(overrides = {}) {
    return {
        query: {},
        params: {},
        body: {},
        user: { userId: 'admin-1', role: 'Administrador' },
        ...overrides
    };
}

describe('adminController unitario', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
    });

    describe('listUsers', () => {
        it('lista usuarios com filtros combinados, ordenacao desc e paginacao', async () => {
            const users = [
                {
                    id: 'user-2',
                    username: 'zeta',
                    email: 'zeta@teste.local',
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada'
                }
            ];
            prisma.$transaction.mockResolvedValue([users, 1]);
            const req = makeReq({
                query: {
                    term: 'zet',
                    role: 'Usuário Padrão',
                    status: 'Ativada',
                    order: 'DESC',
                    page: '2',
                    limit: '5'
                }
            });
            const res = makeRes();

            await adminController.listUsers(req, res);

            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    OR: expect.any(Array),
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada'
                }),
                orderBy: { username: 'desc' },
                skip: 5,
                take: 5
            }));
            expect(prisma.user.count).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    nivelAcesso: 'Usuário Padrão',
                    status: 'Ativada'
                })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                users: [
                    {
                        id: 'user-2',
                        username: 'zeta',
                        email: 'zeta@teste.local',
                        role: 'Usuário Padrão',
                        status: 'Ativada'
                    }
                ],
                pagination: {
                    page: 2,
                    limit: 5,
                    total: 1,
                    totalPages: 1
                }
            });
        });

        it('rejeita filtros inválidos', async () => {
            const req = makeReq({ query: { order: 'INVALIDO' } });
            const res = makeRes();

            await adminController.listUsers(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.user.findMany).not.toHaveBeenCalled();
        });

        it('encaminha falha inesperada da consulta de usuarios ao handler global', async () => {
            const error = new Error('falha no banco');
            prisma.$transaction.mockRejectedValue(error);
            const req = makeReq();
            const res = makeRes();
            const next = jest.fn();

            await adminController.listUsers(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
            expect(res.status).not.toHaveBeenCalledWith(500);
        });
    });

    describe('updateUserRole', () => {
        it('atualiza nivel de acesso de outro usuario', async () => {
            prisma.user.update.mockResolvedValue({
                id: 'user-2',
                username: 'maria',
                email: 'maria@teste.local',
                nivelAcesso: 'Administrador',
                status: 'Ativada'
            });
            const req = makeReq({
                params: { id: 'user-2' },
                body: { role: 'Administrador' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'user-2' },
                data: { nivelAcesso: 'Administrador' }
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                user: {
                    id: 'user-2',
                    username: 'maria',
                    email: 'maria@teste.local',
                    role: 'Administrador',
                    status: 'Ativada'
                }
            });
        });

        it('bloqueia automodificacao do administrador autenticado', async () => {
            const req = makeReq({
                params: { id: 'admin-1' },
                body: { role: 'Usuário Padrão' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Você não pode alterar o nível de acesso de sua própria conta!'
            });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('rejeita nivel de acesso invalido', async () => {
            const req = makeReq({
                params: { id: 'user-2' },
                body: { role: 'Dono' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('retorna 404 quando usuario alvo nao existe', async () => {
            prisma.user.update.mockRejectedValue({ code: 'P2025' });
            const req = makeReq({
                params: { id: 'user-2' },
                body: { role: 'Administrador' }
            });
            const res = makeRes();

            await adminController.updateUserRole(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('encaminha falha inesperada da atualizacao de nivel ao handler global', async () => {
            const error = new Error('falha inesperada');
            prisma.user.update.mockRejectedValue(error);
            const req = makeReq({
                params: { id: 'user-2' },
                body: { role: 'Administrador' }
            });
            const res = makeRes();
            const next = jest.fn();

            await adminController.updateUserRole(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
            expect(res.status).not.toHaveBeenCalledWith(500);
        });
    });

    describe('opcoes administrativas', () => {
        const category = {
            id: 1,
            slug: 'generos',
            name: 'Gêneros'
        };

        it('lista valores ativos de uma categoria em ordem alfabetica', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue(category);
            prisma.$transaction.mockResolvedValue([[
                {
                    id: 10,
                    label: 'Ação',
                    category
                }
            ], 1]);
            const req = makeReq({
                params: { category: 'generos' },
                query: {
                    term: 'a',
                    order: 'DESC',
                    page: '2',
                    limit: '5'
                }
            });
            const res = makeRes();

            await adminController.listOptions(req, res);

            expect(prisma.domainOptionValue.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    categoryId: 1,
                    active: true,
                    label: expect.objectContaining({
                        contains: 'a',
                        mode: 'insensitive'
                    })
                }),
                orderBy: { label: 'desc' },
                skip: 5,
                take: 5
            }));
            expect(prisma.domainOptionValue.count).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    categoryId: 1,
                    active: true
                })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                category: {
                    slug: 'generos',
                    name: 'Gêneros'
                },
                values: [
                    {
                        id: 10,
                        label: 'Ação',
                        category: {
                            slug: 'generos',
                            name: 'Gêneros'
                        },
                        depends_on: []
                    }
                ],
                pagination: {
                    page: 2,
                    limit: 5,
                    total: 1,
                    totalPages: 1
                }
            });
        });

        it('lista opcoes do formulário de obra em uma unica resposta', async () => {
            const workTypes = [
                {
                    id: 9,
                    label: 'Manga',
                    category: { slug: 'tipos-obra', name: 'Tipo de obra' },
                    dependencies: [
                        {
                            dependsOnValue: {
                                id: 5,
                                label: 'Japao',
                                category: { slug: 'paises-origem', name: 'Pais de origem' }
                            }
                        }
                    ]
                }
            ];
            const simpleList = [
                {
                    id: 1,
                    label: 'Valor',
                    category: { slug: 'categoria', name: 'Categoria' }
                }
            ];

            prisma.domainOptionValue.findMany
                .mockReturnValueOnce('authorsQuery')
                .mockReturnValueOnce('workTypesQuery')
                .mockReturnValueOnce('genresQuery')
                .mockReturnValueOnce('magazinesQuery')
                .mockReturnValueOnce('originalPublishersQuery');
            prisma.$transaction.mockResolvedValue([
                simpleList,
                workTypes,
                simpleList,
                [],
                []
            ]);
            const req = makeReq();
            const res = makeRes();

            await adminController.getWorkFormOptions(req, res);

            expect(prisma.$transaction).toHaveBeenCalledWith([
                'authorsQuery',
                'workTypesQuery',
                'genresQuery',
                'magazinesQuery',
                'originalPublishersQuery'
            ]);
            expect(prisma.domainOptionValue.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    active: true,
                    category: { slug: 'tipos-obra' }
                })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                options: expect.objectContaining({
                    workTypes: [
                        expect.objectContaining({
                            id: 9,
                            label: 'Manga',
                            depends_on: [
                                expect.objectContaining({ id: 5, label: 'Japao' })
                            ]
                        })
                    ]
                })
            }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                options: expect.not.objectContaining({
                    authorRoles: expect.anything(),
                    countries: expect.anything(),
                    demographics: expect.anything(),
                    originalStatus: expect.anything()
                })
            }));
        });

        it('cadastra novo valor quando nao existe duplicidade', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue(category);
            prisma.domainOptionValue.findMany.mockResolvedValue([]);
            prisma.domainOptionValue.create.mockResolvedValue({
                id: 11,
                label: 'Comédia',
                category
            });
            prisma.$transaction.mockImplementation(async (callback) => callback({
                domainOptionValue: {
                    create: prisma.domainOptionValue.create,
                    findUniqueOrThrow: prisma.domainOptionValue.findUniqueOrThrow
                },
                domainOptionValueDependency: {
                    createMany: prisma.domainOptionValueDependency.createMany
                }
            }));
            const req = makeReq({
                body: {
                    category: 'generos',
                    label: 'Comédia'
                }
            });
            const res = makeRes();

            await adminController.createOption(req, res);

            expect(prisma.domainOptionValue.create).toHaveBeenCalledWith(expect.objectContaining({
                data: {
                    categoryId: 1,
                    label: 'Comédia'
                }
            }));
            expect(res.status).toHaveBeenCalledWith(201);
        });

        it('bloqueia cadastro de valor dependente sem pais relacionado', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue({
                id: 2,
                slug: 'tipos-obra',
                name: 'Tipo de obra'
            });
            prisma.domainOptionValue.findFirst.mockResolvedValue(null);
            prisma.domainOptionValue.findMany.mockResolvedValue([]);
            const req = makeReq({
                body: {
                    category: 'tipos-obra',
                    label: 'Mangá'
                }
            });
            const res = makeRes();

            await adminController.createOption(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Selecione ao menos um país de origem relacionado.'
            });
            expect(prisma.domainOptionValue.create).not.toHaveBeenCalled();
        });

        it('cadastra valor dependente vinculando aos paises relacionados', async () => {
            const dependentCategory = {
                id: 2,
                slug: 'tipos-obra',
                name: 'Tipo de obra'
            };
            const countryCategory = {
                slug: 'paises-origem',
                name: 'País de Origem'
            };
            prisma.domainOptionCategory.findUnique.mockResolvedValue(dependentCategory);
            prisma.domainOptionValue.findFirst.mockResolvedValue(null);
            prisma.domainOptionValue.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ id: 20 }, { id: 21 }]);
            const txDomainOptionValue = {
                create: jest.fn().mockResolvedValue({
                    id: 12,
                    label: 'Novel',
                    category: dependentCategory
                }),
                findUniqueOrThrow: jest.fn().mockResolvedValue({
                    id: 12,
                    label: 'Novel',
                    category: dependentCategory,
                    dependencies: [
                        {
                            dependsOnValue: {
                                id: 20,
                                label: 'Japão',
                                category: countryCategory
                            }
                        },
                        {
                            dependsOnValue: {
                                id: 21,
                                label: 'Coreia do Sul',
                                category: countryCategory
                            }
                        }
                    ]
                })
            };
            const txDomainOptionValueDependency = {
                createMany: jest.fn()
            };
            prisma.$transaction.mockImplementation(async (callback) => callback({
                domainOptionValue: txDomainOptionValue,
                domainOptionValueDependency: txDomainOptionValueDependency
            }));
            const req = makeReq({
                body: {
                    category: 'tipos-obra',
                    label: 'Novel',
                    dependsOnValueIds: [20, 21, 20]
                }
            });
            const res = makeRes();

            await adminController.createOption(req, res);

            expect(prisma.domainOptionValue.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
                where: expect.objectContaining({
                    id: { in: [20, 21] },
                    active: true,
                    category: {
                        slug: 'paises-origem'
                    }
                }),
                select: { id: true }
            }));
            expect(txDomainOptionValue.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    categoryId: 2,
                    label: 'Novel'
                })
            }));
            expect(txDomainOptionValueDependency.createMany).toHaveBeenCalledWith({
                data: [
                    { dependentValueId: 12, dependsOnValueId: 20 },
                    { dependentValueId: 12, dependsOnValueId: 21 }
                ]
            });
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                value: {
                    id: 12,
                    label: 'Novel',
                    category: {
                        slug: 'tipos-obra',
                        name: 'Tipo de obra'
                    },
                    depends_on: [
                        {
                            id: 20,
                            label: 'Japão',
                            category: countryCategory
                        },
                        {
                            id: 21,
                            label: 'Coreia do Sul',
                            category: countryCategory
                        }
                    ]
                }
            }));
        });

        it('cadastra multiplos valores separados por virgula em uma unica transacao', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue(category);
            prisma.domainOptionValue.findMany.mockResolvedValue([]);
            const createdLabels = ['Comédia', 'Drama', 'Aventura'];
            prisma.domainOptionValue.create.mockImplementation(({ data }) => Promise.resolve({
                id: createdLabels.indexOf(data.label) + 20,
                label: data.label,
                category
            }));
            prisma.$transaction.mockImplementation(async (callback) => callback({
                domainOptionValue: {
                    create: prisma.domainOptionValue.create,
                    findUniqueOrThrow: prisma.domainOptionValue.findUniqueOrThrow
                },
                domainOptionValueDependency: {
                    createMany: prisma.domainOptionValueDependency.createMany
                }
            }));
            const req = makeReq({
                body: {
                    category: 'generos',
                    label: 'Comédia, Drama, Aventura'
                }
            });
            const res = makeRes();

            await adminController.createOption(req, res);

            expect(prisma.domainOptionValue.create).toHaveBeenCalledTimes(3);
            expect(prisma.domainOptionValue.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
                data: {
                    categoryId: 1,
                    label: 'Comédia'
                }
            }));
            expect(prisma.domainOptionValue.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
                data: {
                    categoryId: 1,
                    label: 'Drama'
                }
            }));
            expect(prisma.domainOptionValue.create).toHaveBeenNthCalledWith(3, expect.objectContaining({
                data: {
                    categoryId: 1,
                    label: 'Aventura'
                }
            }));
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                values: expect.arrayContaining([
                    expect.objectContaining({ label: 'Comédia' }),
                    expect.objectContaining({ label: 'Drama' }),
                    expect.objectContaining({ label: 'Aventura' })
                ])
            }));
        });

        it('preserva virgula decimal como parte do valor na categoria formato', async () => {
            const formatCategory = {
                id: 7,
                slug: 'formatos-fisicos',
                name: 'Formato'
            };
            prisma.domainOptionCategory.findUnique.mockResolvedValue(formatCategory);
            prisma.domainOptionValue.findMany.mockResolvedValue([]);
            prisma.domainOptionValue.create.mockImplementation(({ data }) => Promise.resolve({
                id: 30,
                label: data.label,
                category: formatCategory
            }));
            prisma.$transaction.mockImplementation(async (callback) => callback({
                domainOptionValue: {
                    create: prisma.domainOptionValue.create,
                    findUniqueOrThrow: prisma.domainOptionValue.findUniqueOrThrow
                },
                domainOptionValueDependency: {
                    createMany: prisma.domainOptionValueDependency.createMany
                }
            }));
            const req = makeReq({
                body: {
                    category: 'formatos-fisicos',
                    label: '13,7 x 20 cm'
                }
            });
            const res = makeRes();

            await adminController.createOption(req, res);

            expect(prisma.domainOptionValue.create).toHaveBeenCalledTimes(1);
            expect(prisma.domainOptionValue.create).toHaveBeenCalledWith(expect.objectContaining({
                data: {
                    categoryId: 7,
                    label: '13,7 x 20 cm'
                }
            }));
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                value: expect.objectContaining({ label: '13,7 x 20 cm' })
            }));
        });

        it('rejeita todo o cadastro em lote quando algum valor ja existe', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue(category);
            prisma.domainOptionValue.findMany.mockResolvedValue([{ label: 'Drama' }]);
            const req = makeReq({
                body: {
                    category: 'generos',
                    label: 'Comédia, Drama, Aventura'
                }
            });
            const res = makeRes();

            await adminController.createOption(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa lista já tem esse valor cadastrado: Drama.'
            });
            expect(prisma.domainOptionValue.create).not.toHaveBeenCalled();
        });

        it('bloqueia cadastro duplicado na mesma lista', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue(category);
            prisma.domainOptionValue.findMany.mockResolvedValue([{ label: 'Ação' }]);
            const req = makeReq({
                body: {
                    category: 'generos',
                    label: 'Ação'
                }
            });
            const res = makeRes();

            await adminController.createOption(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa lista já tem esse valor cadastrado: Ação.'
            });
            expect(prisma.domainOptionValue.create).not.toHaveBeenCalled();
        });

        it('atualiza valor quando o novo texto e valido', async () => {
            prisma.domainOptionValue.findUnique.mockResolvedValue({
                id: 10,
                categoryId: 1,
                category: {
                    slug: 'generos'
                }
            });
            prisma.domainOptionValue.findFirst.mockResolvedValue(null);
            prisma.$transaction.mockImplementation(async (callback) => callback({
                domainOptionValueDependency: {
                    deleteMany: jest.fn(),
                    createMany: jest.fn()
                },
                domainOptionValue: {
                    update: prisma.domainOptionValue.update,
                    findUniqueOrThrow: prisma.domainOptionValue.findUniqueOrThrow
                }
            }));
            prisma.domainOptionValue.update.mockResolvedValue({
                id: 10,
                label: 'Aventura',
                category
            });
            const req = makeReq({
                params: { id: '10' },
                body: { label: 'Aventura' }
            });
            const res = makeRes();

            await adminController.updateOption(req, res);

            expect(prisma.domainOptionValue.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 10 },
                data: { label: 'Aventura' }
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('bloqueia exclusão quando o valor está em uso por FK', async () => {
            prisma.domainOptionValue.findUnique.mockResolvedValue({
                id: 10,
                category: { slug: 'generos' }
            });
            prisma.domainOptionValue.delete.mockRejectedValue({ code: 'P2003' });
            const req = makeReq({ params: { id: '10' } });
            const res = makeRes();

            await adminController.deleteOption(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Esse valor está vinculado a um mangá, não pode ser excluído!'
            });
        });

        it('recusa listar ou cadastrar categorias internas', async () => {
            const listRes = makeRes();
            const createRes = makeRes();

            await adminController.listOptions(makeReq({
                params: { category: 'paises-origem' },
                query: {}
            }), listRes);
            await adminController.createOption(makeReq({
                body: { category: 'miolos', label: 'Offset' }
            }), createRes);

            expect(listRes.status).toHaveBeenCalledWith(404);
            expect(createRes.status).toHaveBeenCalledWith(404);
            expect(prisma.domainOptionCategory.findUnique).not.toHaveBeenCalled();
        });

        it('recusa alterar ou excluir um valor de categoria interna', async () => {
            prisma.domainOptionValue.findUnique.mockResolvedValue({
                id: 10,
                categoryId: 99,
                category: { slug: 'paises-origem' }
            });
            const updateRes = makeRes();
            const deleteRes = makeRes();

            await adminController.updateOption(makeReq({
                params: { id: '10' },
                body: { label: 'Brasil' }
            }), updateRes);
            await adminController.deleteOption(makeReq({ params: { id: '10' } }), deleteRes);

            expect(updateRes.status).toHaveBeenCalledWith(404);
            expect(deleteRes.status).toHaveBeenCalledWith(404);
            expect(prisma.domainOptionValue.update).not.toHaveBeenCalled();
            expect(prisma.domainOptionValue.delete).not.toHaveBeenCalled();
        });
    });

    describe('obras administrativas', () => {
        const work = {
            id: 1,
            slug: 'naruto',
            title: 'Naruto',
            originalTitle: 'Naruto',
            originalPublicationStartYear: 1999,
            originalPublicationEndYear: 2014,
            originalVolumeCount: 72,
            directRelease: false,
            visibility: 'Privado',
            adultContent: false,
            coverUrl: 'https://cdn.comanga.test/naruto.jpg',
            type: { id: 1, label: 'Mangá' },
            country: 'Japão',
            originalPublishers: [
                { position: 0, publisher: { id: 9, label: 'Shueisha' } },
                { position: 1, publisher: { id: 10, label: 'Shogakukan' } }
            ],
            originalPublicationStatus: 'Completo',
            authors: [
                {
                    author: { id: 4, label: 'Masashi Kishimoto' },
                    roles: [
                        { role: 'História e Arte' }
                    ]
                },
                {
                    author: { id: 11, label: 'Osamu Tezuka' },
                    roles: [
                        { role: 'Criador Original' },
                        { role: 'Ilustrador' }
                    ]
                }
            ],
            genres: [{ genre: { id: 6, label: 'Ação' } }],
            demographics: [{ demography: 'Shonen' }],
            serializationMagazines: [{ position: 0, magazine: { id: 8, label: 'Weekly Shonen Jump' } }]
        };

        function mockValidDomainReferences() {
            prisma.domainOptionValue.count.mockImplementation(({ where }) => (
                Promise.resolve(where.id?.in?.length || 1)
            ));
            prisma.domainOptionValue.findMany.mockResolvedValue([]);
        }

        function mockExistingWorkForUpdate(overrides = {}) {
            return {
                id: 1,
                country: 'Japão',
                typeId: 1,
                authors: [{ authorId: 4 }, { authorId: 11 }],
                originalPublishers: [{ publisherId: 9 }, { publisherId: 10 }],
                serializationMagazines: [{ magazineId: 8 }],
                ...overrides
            };
        }

        it('cadastra obra privada com campos nativos e multiplos papeis por autor', async () => {
            prisma.work.findFirst.mockResolvedValue(null);
            mockValidDomainReferences();
            prisma.$transaction.mockImplementation(async (callback) => callback({
                work: {
                    create: prisma.work.create,
                    findUniqueOrThrow: prisma.work.findUniqueOrThrow
                },
                workAuthorRole: {
                    createMany: prisma.workAuthorRole.createMany
                }
            }));
            prisma.work.create.mockResolvedValue(work);
            prisma.work.findUniqueOrThrow.mockResolvedValue(work);
            const req = makeReq({
                body: {
                    title: 'Naruto',
                    originalTitle: 'Naruto',
                    originalPublicationStartYear: 1999,
                    originalPublicationEndYear: 2014,
                    originalVolumeCount: 72,
                    directRelease: false,
                    typeId: 1,
                    country: 'Japão',
                    originalPublisherIds: [{ id: 10, position: 0 }, { id: 9, position: 1 }],
                    originalPublicationStatus: 'Completo',
                    coverUrl: 'https://cdn.comanga.test/naruto.jpg',
                    adultContent: false,
                    authors: [
                        { authorId: 4, roles: ['História e Arte'] },
                        { authorId: 11, roles: ['Criador Original', 'Ilustrador'] }
                    ],
                    genreIds: [6],
                    demographies: ['Shonen'],
                    magazineIds: [{ id: 8, position: 0 }]
                }
            });
            const res = makeRes();

            await adminController.createWork(req, res);

            expect(prisma.work.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    slug: 'naruto',
                    title: 'Naruto',
                    visibility: 'Privado',
                    country: 'Japão',
                    originalPublicationStatus: 'Completo',
                    originalPublishers: {
                        createMany: {
                            data: [{ publisherId: 10, position: 0 }, { publisherId: 9, position: 1 }]
                        }
                    },
                    authors: {
                        createMany: {
                            data: [{ authorId: 4 }, { authorId: 11 }]
                        }
                    },
                    demographics: {
                        createMany: {
                            data: [{ demography: 'Shonen' }]
                        }
                    },
                    serializationMagazines: {
                        createMany: {
                            data: [{ magazineId: 8, position: 0 }]
                        }
                    }
                })
            }));
            expect(prisma.work.create.mock.calls[0][0].data).not.toHaveProperty('originalPublisherId');
            expect(prisma.workAuthorRole.createMany).toHaveBeenCalledWith({
                data: [
                    { workId: 1, authorId: 4, role: 'História e Arte' },
                    { workId: 1, authorId: 11, role: 'Criador Original' },
                    { workId: 1, authorId: 11, role: 'Ilustrador' }
                ]
            });
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                work: expect.objectContaining({
                    title: 'Naruto',
                    visibility: 'Privado',
                    country: 'Japão',
                    originalPublicationStatus: 'Completo',
                    authors: [
                        expect.objectContaining({
                            author: { id: 4, label: 'Masashi Kishimoto' },
                            roles: ['História e Arte']
                        }),
                        expect.objectContaining({
                            author: { id: 11, label: 'Osamu Tezuka' },
                            roles: ['Criador Original', 'Ilustrador']
                        })
                    ]
                })
            }));
        });

        it('consulta uma obra diretamente pelo slug sem executar listagem auxiliar', async () => {
            prisma.work.findUnique.mockResolvedValue(work);
            const req = makeReq({ params: { slug: 'naruto' } });
            const res = makeRes();

            await adminController.getWorkBySlug(req, res, jest.fn());

            expect(prisma.work.findUnique).toHaveBeenCalledWith(expect.objectContaining({
                where: { slug: 'naruto' }
            }));
            expect(prisma.work.findMany).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                work: expect.objectContaining({ slug: 'naruto', title: 'Naruto' })
            });
        });

        it('retorna 404 seguro ao consultar slug inexistente', async () => {
            prisma.work.findUnique.mockResolvedValue(null);
            const req = makeReq({ params: { slug: 'obra-inexistente' } });
            const res = makeRes();

            await adminController.getWorkBySlug(req, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Obra não encontrada.' });
        });

        it('bloqueia autor duplicado mesmo com papeis diferentes antes de consultar o banco', async () => {
            const req = makeReq({
                body: {
                    title: 'Naruto',
                    typeId: 1,
                    country: 'Japão',
                    originalPublicationStatus: 'Completo',
                    authors: [
                        { authorId: 4, roles: ['História'] },
                        { authorId: 4, roles: ['Arte'] }
                    ]
                }
            });
            const res = makeRes();

            await adminController.createWork(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Autor duplicado!' });
            expect(prisma.work.findFirst).not.toHaveBeenCalled();
        });

        it('bloqueia autor relacionado a outro pais de origem', async () => {
            prisma.work.findFirst.mockResolvedValue(null);
            mockValidDomainReferences();
            prisma.domainOptionValue.findMany.mockResolvedValue([
                {
                    id: 4,
                    dependencies: [
                        {
                            dependsOnValue: {
                                label: 'Coreia do Sul',
                                category: { slug: 'paises-origem' }
                            }
                        }
                    ]
                }
            ]);
            const req = makeReq({
                body: {
                    title: 'Naruto',
                    typeId: 1,
                    country: 'Japão',
                    originalPublicationStatus: 'Completo',
                    authors: [{ authorId: 4, roles: ['História'] }],
                    genreIds: [6]
                }
            });
            const res = makeRes();

            await adminController.createWork(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Um ou mais valores selecionados são inválidos.' });
            expect(prisma.work.create).not.toHaveBeenCalled();
        });

        it('rejeita valores nativos inválidos ao cadastrar obra', async () => {
            const req = makeReq({
                body: {
                    title: 'Naruto',
                    typeId: 1,
                    country: 'Estados Unidos',
                    originalPublicationStatus: 'Publicado',
                    authors: [{ authorId: 4, roles: ['Editor'] }],
                    genreIds: [6],
                    demographies: ['Adulto']
                }
            });
            const res = makeRes();

            await adminController.createWork(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.work.findFirst).not.toHaveBeenCalled();
        });

        it('rejeita o campo singular legado de Editora original', async () => {
            const req = makeReq({
                body: {
                    title: 'Naruto',
                    typeId: 1,
                    country: 'Japão',
                    originalPublisherId: 9,
                    originalPublicationStatus: 'Completo',
                    authors: [{ authorId: 4, roles: ['História e Arte'] }]
                }
            });
            const res = makeRes();

            await adminController.createWork(req, res, jest.fn());

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.work.findFirst).not.toHaveBeenCalled();
        });

        it('lista obras com filtros e limite maximo de 50', async () => {
            prisma.$transaction.mockResolvedValue([[work], 1]);
            const req = makeReq({
                query: {
                    term: 'nar',
                    typeId: '1',
                    country: 'Japão',
                    visibility: 'Privado',
                    sortBy: 'country',
                    order: 'DESC',
                    page: '2',
                    limit: '50'
                }
            });
            const res = makeRes();

            await adminController.listWorks(req, res);

            expect(prisma.work.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    typeId: 1,
                    country: 'Japão',
                    visibility: 'Privado'
                }),
                orderBy: { country: 'desc' },
                skip: 50,
                take: 50
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                works: [
                    expect.objectContaining({
                        title: 'Naruto',
                        visibility: 'Privado'
                    })
                ],
                pagination: {
                    page: 2,
                    limit: 50,
                    total: 1,
                    totalPages: 1
                }
            }));
        });

        it('altera parcialmente uma obra preservando campos nao enviados', async () => {
            prisma.work.findUnique
                .mockResolvedValueOnce(mockExistingWorkForUpdate())
                .mockResolvedValueOnce({
                    ...work,
                    title: 'Naruto - Edicao Revisada'
                });
            prisma.work.findFirst.mockResolvedValue(null);
            prisma.work.update.mockResolvedValue({
                ...work,
                title: 'Naruto - Edicao Revisada'
            });
            mockValidDomainReferences();
            prisma.$transaction.mockResolvedValue([]);
            const req = makeReq({
                params: { id: '1' },
                body: {
                    title: 'Naruto - Edicao Revisada'
                }
            });
            const res = makeRes();

            await adminController.updateWork(req, res);

            expect(prisma.work.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 1 },
                data: { title: 'Naruto - Edicao Revisada' }
            }));
            expect(prisma.work.update.mock.calls[0][0].data).not.toHaveProperty('slug');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                work: expect.objectContaining({
                    title: 'Naruto - Edicao Revisada'
                })
            }));
        });

        it('altera campos nativos e multiplos papeis de autoria em uma obra existente', async () => {
            prisma.work.findUnique
                .mockResolvedValueOnce(mockExistingWorkForUpdate())
                .mockResolvedValueOnce({
                    ...work,
                    country: 'Coreia do Sul',
                    originalPublicationStatus: 'Em andamento',
                    authors: [
                        {
                            author: { id: 11, label: 'Osamu Tezuka' },
                            roles: [{ role: 'Ilustrador' }]
                        },
                        {
                            author: { id: 4, label: 'Masashi Kishimoto' },
                            roles: [{ role: 'História' }, { role: 'Arte' }]
                        }
                    ],
                    demographics: [{ demography: 'Seinen' }]
            });
            prisma.work.findFirst.mockResolvedValue(null);
            mockValidDomainReferences();
            prisma.$transaction.mockResolvedValue([]);
            const req = makeReq({
                params: { id: '1' },
                body: {
                    country: 'Coreia do Sul',
                    originalPublicationStatus: 'Em andamento',
                    authors: [
                        { authorId: 4, roles: ['História', 'Arte'] },
                        { authorId: 11, roles: ['Ilustrador'] }
                    ],
                    demographies: ['Seinen']
                }
            });
            const res = makeRes();

            await adminController.updateWork(req, res);

            expect(prisma.work.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 1 },
                data: {
                    country: 'Coreia do Sul',
                    originalPublicationStatus: 'Em andamento'
                }
            }));
            expect(prisma.workAuthor.deleteMany).toHaveBeenCalledWith({ where: { workId: 1 } });
            expect(prisma.workAuthor.createMany).toHaveBeenCalledWith({
                data: [
                    { workId: 1, authorId: 4 },
                    { workId: 1, authorId: 11 }
                ]
            });
            expect(prisma.workAuthorRole.createMany).toHaveBeenCalledWith({
                data: [
                    { workId: 1, authorId: 4, role: 'História' },
                    { workId: 1, authorId: 4, role: 'Arte' },
                    { workId: 1, authorId: 11, role: 'Ilustrador' }
                ]
            });
            expect(prisma.workDemography.createMany).toHaveBeenCalledWith({
                data: [{ workId: 1, demography: 'Seinen' }]
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                work: expect.objectContaining({
                    country: 'Coreia do Sul',
                    originalPublicationStatus: 'Em andamento',
                    authors: [
                        expect.objectContaining({
                            author: { id: 4, label: 'Masashi Kishimoto' },
                            roles: ['História', 'Arte']
                        }),
                        expect.objectContaining({
                            author: { id: 11, label: 'Osamu Tezuka' },
                            roles: ['Ilustrador']
                        })
                    ],
                    demographics: ['Seinen']
                })
            }));
        });

        it('altera editoras e revistas preservando a posicao informada', async () => {
            prisma.work.findUnique
                .mockResolvedValueOnce(mockExistingWorkForUpdate())
                .mockResolvedValueOnce({
                    ...work,
                    originalPublishers: [
                        { position: 0, publisher: { id: 10, label: 'Shogakukan' } },
                        { position: 1, publisher: { id: 9, label: 'Shueisha' } }
                    ],
                    serializationMagazines: [
                        { position: 0, magazine: { id: 12, label: 'Big Comic Original' } },
                        { position: 1, magazine: { id: 8, label: 'Weekly Shonen Jump' } }
                    ]
            });
            prisma.work.findFirst.mockResolvedValue(null);
            mockValidDomainReferences();
            prisma.$transaction.mockResolvedValue([]);
            const req = makeReq({
                params: { id: '1' },
                body: {
                    originalPublisherIds: [{ id: 10, position: 0 }, { id: 9, position: 1 }],
                    magazineIds: [{ id: 12, position: 0 }, { id: 8, position: 1 }]
                }
            });
            const res = makeRes();

            await adminController.updateWork(req, res);

            expect(prisma.work.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 1 }
            }));
            expect(prisma.work.update.mock.calls[0][0].data).not.toHaveProperty('originalPublisherId');
            expect(prisma.workOriginalPublisher.deleteMany).toHaveBeenCalledWith({ where: { workId: 1 } });
            expect(prisma.workOriginalPublisher.createMany).toHaveBeenCalledWith({
                data: [
                    { workId: 1, publisherId: 10, position: 0 },
                    { workId: 1, publisherId: 9, position: 1 }
                ]
            });
            expect(prisma.workSerializationMagazine.deleteMany).toHaveBeenCalledWith({ where: { workId: 1 } });
            expect(prisma.workSerializationMagazine.createMany).toHaveBeenCalledWith({
                data: [
                    { workId: 1, magazineId: 12, position: 0 },
                    { workId: 1, magazineId: 8, position: 1 }
                ]
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                work: expect.objectContaining({
                    originalPublishers: [
                        { id: 10, label: 'Shogakukan' },
                        { id: 9, label: 'Shueisha' }
                    ],
                    serializationMagazines: [
                        { id: 12, label: 'Big Comic Original' },
                        { id: 8, label: 'Weekly Shonen Jump' }
                    ]
                })
            }));
        });

        it('rejeita valores nativos inválidos ao alterar obra antes de consultar o banco', async () => {
            const req = makeReq({
                params: { id: '1' },
                body: {
                    country: 'Brasil',
                    originalPublicationStatus: 'Publicado',
                    authors: [{ authorId: 4, roles: ['Editor'] }],
                    demographies: ['Adulto']
                }
            });
            const res = makeRes();

            await adminController.updateWork(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.work.findUnique).not.toHaveBeenCalled();
        });

        it('bloqueia exclusão de obra pública', async () => {
            prisma.work.findUnique.mockResolvedValue({
                id: 1,
                visibility: 'Público'
            });
            const req = makeReq({ params: { id: '1' } });
            const res = makeRes();

            await adminController.deleteWork(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa Obra está pública, não pode ser excluída!'
            });
            expect(prisma.work.delete).not.toHaveBeenCalled();
        });

        it('bloqueia rebaixamento para privado quando obra possui edições públicas', async () => {
            prisma.work.findUnique.mockResolvedValue({
                id: 1,
                visibility: 'Público'
            });
            prisma.edition.count.mockResolvedValue(1);
            const req = makeReq({
                params: { id: '1' },
                body: { visibility: 'Privado' }
            });
            const res = makeRes();

            await adminController.updateWorkVisibility(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa Obra possui Edições públicas, não pode ser rebaixada para privada!'
            });
            expect(prisma.work.update).not.toHaveBeenCalled();
        });

        it('bloqueia exclusão de obra privada quando ainda possui edições vinculadas', async () => {
            prisma.work.findUnique.mockResolvedValue({
                id: 1,
                visibility: 'Privado'
            });
            prisma.edition.count.mockResolvedValue(2);
            const req = makeReq({ params: { id: '1' } });
            const res = makeRes();

            await adminController.deleteWork(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa Obra possui Edições vinculadas, não pode ser excluída!'
            });
            expect(prisma.work.delete).not.toHaveBeenCalled();
        });
    });

    describe('edições administrativas', () => {
        const edition = {
            id: 20,
            workId: 1,
            chronologicalNumber: 1,
            coverUrl: 'https://cdn.comanga.test/edição.jpg',
            visibility: 'Privado',
            brazilianPublisher: { id: 2, label: 'Panini' },
            editionType: { id: 3, label: 'Tankobon' },
            coverType: { id: 4, label: 'Capa comum' },
            format: { id: 5, label: 'Impresso' },
            brazilPublicationStatus: 'Completo'
        };

        function mockValidEditionReferences() {
            prisma.domainOptionValue.count.mockImplementation(({ where }) => (
                Promise.resolve(where.id?.in?.length || 1)
            ));
        }

        it('cadastra edição privada vinculada a uma obra', async () => {
            prisma.work.findUnique.mockResolvedValue({ id: 1 });
            mockValidEditionReferences();
            prisma.edition.create.mockResolvedValue(edition);
            const req = makeReq({
                params: { workId: '1' },
                body: {
                    brazilianPublisherId: 2,
                    editionTypeId: 3,
                    coverTypeId: 4,
                    formatId: 5,
                    chronologicalNumber: 1,
                    brazilPublicationStatus: 'Completo',
                    coverUrl: 'https://cdn.comanga.test/edição.jpg'
                }
            });
            const res = makeRes();

            await adminController.createEdition(req, res);

            expect(prisma.edition.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    workId: 1,
                    chronologicalNumber: 1,
                    visibility: 'Privado'
                })
            }));
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                edition: expect.objectContaining({
                    id: 20,
                    workId: 1,
                    chronologicalNumber: 1,
                    visibility: 'Privado'
                })
            });
        });

        it('bloqueia número cronologico duplicado dentro da mesma obra', async () => {
            prisma.work.findUnique.mockResolvedValue({ id: 1 });
            mockValidEditionReferences();
            prisma.edition.create.mockRejectedValue({ code: 'P2002' });
            const req = makeReq({
                params: { workId: '1' },
                body: {
                    brazilianPublisherId: 2,
                    editionTypeId: 3,
                    coverTypeId: 4,
                    formatId: 5,
                    chronologicalNumber: 1,
                    brazilPublicationStatus: 'Completo'
                }
            });
            const res = makeRes();

            await adminController.createEdition(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa Obra já possui uma Edição com esse número cronológico!'
            });
        });

        it('lista edições de uma obra em ordem cronologica decrescente', async () => {
            prisma.work.findUnique.mockResolvedValue({ id: 1 });
            prisma.$transaction.mockResolvedValue([[edition], 1]);
            const req = makeReq({
                params: { workId: '1' },
                query: { order: 'DESC', page: '2', limit: '5' }
            });
            const res = makeRes();

            await adminController.listEditionsByWork(req, res);

            expect(prisma.edition.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { workId: 1 },
                orderBy: { chronologicalNumber: 'desc' },
                skip: 5,
                take: 5
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                editions: [expect.objectContaining({ id: 20 })],
                pagination: {
                    page: 2,
                    limit: 5,
                    total: 1,
                    totalPages: 1
                }
            });
        });

        it('bloqueia públicacao quando a obra matriz está privada', async () => {
            prisma.edition.findUnique.mockResolvedValue({
                id: 20,
                work: { visibility: 'Privado' }
            });
            const req = makeReq({
                params: { id: '20' },
                body: { visibility: 'Público' }
            });
            const res = makeRes();

            await adminController.updateEditionVisibility(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa Edição está vinculada a uma Obra privada, não pode ser publicada!'
            });
            expect(prisma.edition.update).not.toHaveBeenCalled();
            expect(prisma.volume.updateMany).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it('propaga visibilidade pública da edição para seus volumes na mesma transacao', async () => {
            const updatedEdition = {
                ...edition,
                visibility: 'Público',
                work: { visibility: 'Público' }
            };
            prisma.edition.findUnique.mockResolvedValue({
                id: 20,
                work: { visibility: 'Público' }
            });
            prisma.edition.update.mockReturnValue('updateEditionQuery');
            prisma.volume.updateMany.mockReturnValue('updateVolumesQuery');
            prisma.$transaction.mockResolvedValue([updatedEdition, { count: 3 }]);
            const req = makeReq({
                params: { id: '20' },
                body: { visibility: 'Público' }
            });
            const res = makeRes();

            await adminController.updateEditionVisibility(req, res);

            expect(prisma.edition.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 20 },
                data: { visibility: 'Público' }
            }));
            expect(prisma.volume.updateMany).toHaveBeenCalledWith({
                where: { editionId: 20 },
                data: { visibility: 'Público' }
            });
            expect(prisma.$transaction).toHaveBeenCalledWith([
                'updateEditionQuery',
                'updateVolumesQuery'
            ]);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                edition: expect.objectContaining({
                    id: 20,
                    visibility: 'Público'
                })
            });
        });

        it('bloqueia exclusão de edição privada quando ainda possui volumes vinculados', async () => {
            prisma.edition.findUnique.mockResolvedValue({
                id: 20,
                visibility: 'Privado'
            });
            prisma.volume.count.mockResolvedValue(4);
            const req = makeReq({ params: { id: '20' } });
            const res = makeRes();

            await adminController.deleteEdition(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa Edição possui Volumes vinculados, não pode ser excluída!'
            });
            expect(prisma.edition.delete).not.toHaveBeenCalled();
        });
    });

    describe('volumes administrativos', () => {
        const volume = {
            id: 30,
            editionId: 20,
            number: 1,
            coverUrl: 'https://cdn.comanga.test/volume-1.jpg',
            singleVolume: true,
            pages: 200,
            price: 39.9,
            priceCurrency: 'R$',
            releaseDatePrecision: 'Completa',
            releaseYear: 2026,
            releaseMonth: 1,
            releaseDay: 10,
            isbn10: '123456789X',
            isbn13: '9781234567897',
            affiliateLink: 'https://loja.test/volume-1',
            synopsis: 'Sinopse do volume.',
            visibility: 'Privado'
        };

        it('cadastra volume herdando visibilidade da edição', async () => {
            prisma.edition.findUnique.mockResolvedValue({ id: 20, visibility: 'Privado' });
            prisma.volume.create.mockResolvedValue(volume);
            const req = makeReq({
                params: { editionId: '20' },
                body: {
                    number: 1,
                    coverUrl: 'https://cdn.comanga.test/volume-1.jpg',
                    singleVolume: true,
                    pages: 200,
                    price: 39.9,
                    priceCurrency: 'R$',
                    releaseDatePrecision: 'Completa',
                    releaseYear: 2026,
                    releaseMonth: 1,
                    releaseDay: 10,
                    isbn10: '123456789X',
                    isbn13: '9781234567897',
                    affiliateLink: 'https://loja.test/volume-1',
                    synopsis: 'Sinopse do volume.'
                }
            });
            const res = makeRes();

            await adminController.createVolume(req, res);

            expect(prisma.volume.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    editionId: 20,
                    number: 1,
                    singleVolume: true,
                    visibility: 'Privado'
                })
            }));
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                volume: expect.objectContaining({
                    id: 30,
                    editionId: 20,
                    number: 1,
                    singleVolume: true,
                    visibility: 'Privado',
                    price: 39.9,
                    priceCurrency: 'R$',
                    releaseDatePrecision: 'Completa',
                    releaseYear: 2026,
                    releaseMonth: 1,
                    releaseDay: 10
                })
            });
        });

        it('bloqueia volume duplicado dentro da mesma edição', async () => {
            prisma.edition.findUnique.mockResolvedValue({ id: 20, visibility: 'Privado' });
            prisma.volume.create.mockRejectedValue({ code: 'P2002' });
            const req = makeReq({
                params: { editionId: '20' },
                body: {
                    number: 0,
                    coverUrl: 'https://cdn.comanga.test/volume-0.jpg',
                    releaseDatePrecision: 'Completa',
                    releaseYear: 2026,
                    releaseMonth: 1,
                    releaseDay: 10
                }
            });
            const res = makeRes();

            await adminController.createVolume(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Um volume desta edição com esse mesmo número já foi cadastrado anteriormente!'
            });
        });

        it('lista volumes de uma edição em ordem crescente', async () => {
            prisma.edition.findUnique.mockResolvedValue({ id: 20 });
            prisma.$transaction.mockResolvedValue([[volume], 1]);
            const req = makeReq({
                params: { editionId: '20' },
                query: { order: 'ASC', page: '1', limit: '10' }
            });
            const res = makeRes();

            await adminController.listVolumesByEdition(req, res);

            expect(prisma.volume.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { editionId: 20 },
                orderBy: { number: 'asc' },
                skip: 0,
                take: 10
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                volumes: [expect.objectContaining({ id: 30, number: 1 })],
                pagination: {
                    page: 1,
                    limit: 10,
                    total: 1,
                    totalPages: 1
                }
            });
        });

        it('consulta volume detalhado', async () => {
            prisma.volume.findUnique.mockResolvedValue(volume);
            const req = makeReq({ params: { id: '30' } });
            const res = makeRes();

            await adminController.getVolumeById(req, res);

            expect(prisma.volume.findUnique).toHaveBeenCalledWith({
                where: { id: 30 }
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                volume: expect.objectContaining({ id: 30, number: 1 })
            });
        });

        it('bloqueia exclusão de volume publico', async () => {
            prisma.volume.findUnique.mockResolvedValue({ id: 30, visibility: 'Público' });
            const req = makeReq({ params: { id: '30' } });
            const res = makeRes();

            await adminController.deleteVolume(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa Obra está pública, não pode ser excluída!'
            });
            expect(prisma.volume.delete).not.toHaveBeenCalled();
        });
    });

    describe('caminhos alternativos do catalogo administrativo', () => {
        const editionBody = {
            brazilianPublisherId: 2,
            editionTypeId: 3,
            coverTypeId: 4,
            formatId: 5,
            chronologicalNumber: 1,
            brazilPublicationStatus: 'Completo',
            coverUrl: 'https://cdn.comanga.test/edicao.jpg'
        };
        const edition = {
            id: 20,
            workId: 1,
            chronologicalNumber: 1,
            coverUrl: 'https://cdn.comanga.test/edicao.jpg',
            visibility: 'Privado',
            brazilianPublisher: { id: 2, label: 'Panini' },
            editionType: { id: 3, label: 'Tankobon' },
            coverType: { id: 4, label: 'Capa comum' },
            format: { id: 5, label: 'Impresso' },
            brazilPublicationStatus: 'Completo',
            _count: { volumes: 0 }
        };
        const volumeBody = {
            number: 1,
            coverUrl: 'https://cdn.comanga.test/volume-1.jpg',
            releaseDatePrecision: 'Completa',
            releaseYear: 2026,
            releaseMonth: 8,
            releaseDay: 11
        };
        const volume = {
            id: 30,
            editionId: 20,
            number: 1,
            coverUrl: 'https://cdn.comanga.test/volume-1.jpg',
            singleVolume: false,
            pages: null,
            price: null,
            priceCurrency: 'R$',
            releaseDatePrecision: 'Completa',
            releaseYear: 2026,
            releaseMonth: 8,
            releaseDay: 11,
            isbn10: null,
            isbn13: null,
            affiliateLink: null,
            synopsis: null,
            visibility: 'Privado'
        };

        it.each([
            ['getWorkById', { params: { id: 'invalido' } }],
            ['updateWork', { params: { id: '-1' }, body: { title: 'Teste' } }],
            ['deleteWork', { params: { id: '0' } }],
            ['updateWorkVisibility', { params: { id: 'x' }, body: { visibility: 'Privado' } }],
            ['createEdition', { params: { workId: '0' }, body: editionBody }],
            ['listEditionsByWork', { params: { workId: 'x' }, query: {} }],
            ['getEditionById', { params: { id: '-2' } }],
            ['updateEdition', { params: { id: 'x' }, body: { chronologicalNumber: 2 } }],
            ['deleteEdition', { params: { id: '0' } }],
            ['updateEditionVisibility', { params: { id: 'x' }, body: { visibility: 'Privado' } }],
            ['createVolume', { params: { editionId: '-1' }, body: volumeBody }],
            ['listVolumesByEdition', { params: { editionId: 'x' }, query: {} }],
            ['getVolumeById', { params: { id: '0' } }],
            ['updateVolume', { params: { id: 'x' }, body: { pages: 200 } }],
            ['deleteVolume', { params: { id: '-1' } }]
        ])('rejeita identificador invalido em %s', async (handlerName, request) => {
            const res = makeRes();

            await adminController[handlerName](makeReq(request), res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Formato de identificador invalido.' });
        });

        it.each([
            ['listWorks', { query: { limit: '51' } }],
            ['createEdition', { params: { workId: '1' }, body: {} }],
            ['listEditionsByWork', { params: { workId: '1' }, query: { page: '0' } }],
            ['updateEdition', { params: { id: '20' }, body: {} }],
            ['updateEditionVisibility', { params: { id: '20' }, body: { visibility: 'Oculto' } }],
            ['createVolume', { params: { editionId: '20' }, body: { ...volumeBody, releaseDay: undefined } }],
            ['listVolumesByEdition', { params: { editionId: '20' }, query: { limit: '51' } }],
            ['updateVolume', { params: { id: '30' }, body: { priceCurrency: 'USD' } }]
        ])('rejeita payload ou filtro invalido em %s', async (handlerName, request) => {
            const res = makeRes();

            await adminController[handlerName](makeReq(request), res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it.each([
            ['getWorkById', { params: { id: '1' } }, () => prisma.work.findUnique.mockResolvedValue(null)],
            ['updateWork', { params: { id: '1' }, body: { title: 'Teste' } }, () => prisma.work.findUnique.mockResolvedValue(null)],
            ['deleteWork', { params: { id: '1' } }, () => prisma.work.findUnique.mockResolvedValue(null)],
            ['updateWorkVisibility', { params: { id: '1' }, body: { visibility: 'Privado' } }, () => prisma.work.findUnique.mockResolvedValue(null)],
            ['createEdition', { params: { workId: '1' }, body: editionBody }, () => prisma.work.findUnique.mockResolvedValue(null)],
            ['listEditionsByWork', { params: { workId: '1' }, query: {} }, () => prisma.work.findUnique.mockResolvedValue(null)],
            ['getEditionById', { params: { id: '20' } }, () => prisma.edition.findUnique.mockResolvedValue(null)],
            ['updateEdition', { params: { id: '20' }, body: { chronologicalNumber: 2 } }, () => prisma.edition.findUnique.mockResolvedValue(null)],
            ['deleteEdition', { params: { id: '20' } }, () => prisma.edition.findUnique.mockResolvedValue(null)],
            ['updateEditionVisibility', { params: { id: '20' }, body: { visibility: 'Privado' } }, () => prisma.edition.findUnique.mockResolvedValue(null)],
            ['createVolume', { params: { editionId: '20' }, body: volumeBody }, () => prisma.edition.findUnique.mockResolvedValue(null)],
            ['listVolumesByEdition', { params: { editionId: '20' }, query: {} }, () => prisma.edition.findUnique.mockResolvedValue(null)],
            ['getVolumeById', { params: { id: '30' } }, () => prisma.volume.findUnique.mockResolvedValue(null)],
            ['updateVolume', { params: { id: '30' }, body: { pages: 200 } }, () => prisma.volume.findUnique.mockResolvedValue(null)],
            ['deleteVolume', { params: { id: '30' } }, () => prisma.volume.findUnique.mockResolvedValue(null)]
        ])('retorna 404 quando o recurso de %s nao existe', async (handlerName, request, arrange) => {
            arrange();
            const res = makeRes();

            await adminController[handlerName](makeReq(request), res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it.each([
            ['getWorkFormOptions', {}, () => prisma.$transaction.mockRejectedValue(new Error('falha'))],
            ['getEditionFormOptions', {}, () => prisma.$transaction.mockRejectedValue(new Error('falha'))],
            ['listOptions', { params: { category: 'generos' }, query: {} }, () => prisma.domainOptionCategory.findUnique.mockRejectedValue(new Error('falha'))],
            ['createOption', { body: { category: 'generos', label: 'Drama' } }, () => prisma.domainOptionCategory.findUnique.mockRejectedValue(new Error('falha'))],
            ['updateOption', { params: { id: '10' }, body: { label: 'Drama' } }, () => prisma.domainOptionValue.findUnique.mockRejectedValue(new Error('falha'))],
            ['deleteOption', { params: { id: '10' } }, () => prisma.domainOptionValue.findUnique.mockRejectedValue(new Error('falha'))],
            ['listWorks', { query: {} }, () => prisma.$transaction.mockRejectedValue(new Error('falha'))],
            ['getWorkById', { params: { id: '1' } }, () => prisma.work.findUnique.mockRejectedValue(new Error('falha'))],
            ['updateWork', { params: { id: '1' }, body: { title: 'Teste' } }, () => prisma.work.findUnique.mockRejectedValue(new Error('falha'))],
            ['deleteWork', { params: { id: '1' } }, () => prisma.work.findUnique.mockRejectedValue(new Error('falha'))],
            ['updateWorkVisibility', { params: { id: '1' }, body: { visibility: 'Privado' } }, () => prisma.work.findUnique.mockRejectedValue(new Error('falha'))],
            ['createEdition', { params: { workId: '1' }, body: editionBody }, () => prisma.work.findUnique.mockRejectedValue(new Error('falha'))],
            ['listEditionsByWork', { params: { workId: '1' }, query: {} }, () => prisma.work.findUnique.mockRejectedValue(new Error('falha'))],
            ['getEditionById', { params: { id: '20' } }, () => prisma.edition.findUnique.mockRejectedValue(new Error('falha'))],
            ['updateEdition', { params: { id: '20' }, body: { chronologicalNumber: 2 } }, () => prisma.edition.findUnique.mockRejectedValue(new Error('falha'))],
            ['deleteEdition', { params: { id: '20' } }, () => prisma.edition.findUnique.mockRejectedValue(new Error('falha'))],
            ['updateEditionVisibility', { params: { id: '20' }, body: { visibility: 'Privado' } }, () => prisma.edition.findUnique.mockRejectedValue(new Error('falha'))],
            ['createVolume', { params: { editionId: '20' }, body: volumeBody }, () => prisma.edition.findUnique.mockRejectedValue(new Error('falha'))],
            ['listVolumesByEdition', { params: { editionId: '20' }, query: {} }, () => prisma.edition.findUnique.mockRejectedValue(new Error('falha'))],
            ['getVolumeById', { params: { id: '30' } }, () => prisma.volume.findUnique.mockRejectedValue(new Error('falha'))],
            ['updateVolume', { params: { id: '30' }, body: { pages: 200 } }, () => prisma.volume.findUnique.mockRejectedValue(new Error('falha'))],
            ['deleteVolume', { params: { id: '30' } }, () => prisma.volume.findUnique.mockRejectedValue(new Error('falha'))]
        ])('encaminha falha interna de %s ao handler global', async (handlerName, request, arrange) => {
            arrange();
            const res = makeRes();
            const next = jest.fn();

            await adminController[handlerName](makeReq(request), res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(res.status).not.toHaveBeenCalledWith(500);
        });

        it('consulta e atualiza uma edicao existente', async () => {
            prisma.edition.findUnique.mockResolvedValueOnce(edition).mockResolvedValueOnce({ id: 20 });
            prisma.domainOptionValue.count.mockImplementation(({ where }) => Promise.resolve(where.id.in.length));
            prisma.edition.update.mockResolvedValue({
                ...edition,
                chronologicalNumber: 2,
                brazilPublicationStatus: 'Em andamento'
            });
            const detailRes = makeRes();
            const updateRes = makeRes();

            await adminController.getEditionById(makeReq({ params: { id: '20' } }), detailRes);
            await adminController.updateEdition(makeReq({
                params: { id: '20' },
                body: {
                    ...editionBody,
                    chronologicalNumber: 2,
                    brazilPublicationStatus: 'Em andamento',
                    coverUrl: null
                }
            }), updateRes);

            expect(detailRes.status).toHaveBeenCalledWith(200);
            expect(prisma.edition.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 20 },
                data: expect.objectContaining({
                    chronologicalNumber: 2,
                    coverUrl: null
                })
            }));
            expect(updateRes.status).toHaveBeenCalledWith(200);
        });

        it('exclui edicao privada sem volumes', async () => {
            prisma.edition.findUnique.mockResolvedValue({ id: 20, visibility: 'Privado' });
            prisma.volume.count.mockResolvedValue(0);
            prisma.edition.delete.mockReturnValue('deleteEditionQuery');
            prisma.$transaction.mockResolvedValue([edition]);
            const res = makeRes();

            await adminController.deleteEdition(makeReq({ params: { id: '20' } }), res);

            expect(prisma.$transaction).toHaveBeenCalledWith(['deleteEditionQuery']);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('rebaixa edicao privada e propaga a visibilidade aos volumes', async () => {
            prisma.edition.findUnique.mockResolvedValue({ id: 20, work: { visibility: 'Público' } });
            prisma.edition.update.mockReturnValue('updateEditionQuery');
            prisma.volume.updateMany.mockReturnValue('updateVolumesQuery');
            prisma.$transaction.mockResolvedValue([edition, { count: 2 }]);
            const res = makeRes();

            await adminController.updateEditionVisibility(makeReq({
                params: { id: '20' },
                body: { visibility: 'Privado' }
            }), res);

            expect(prisma.volume.updateMany).toHaveBeenCalledWith({
                where: { editionId: 20 },
                data: { visibility: 'Privado' }
            });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('cria volume usando defaults e normaliza campos opcionais', async () => {
            prisma.edition.findUnique.mockResolvedValue({ id: 20, visibility: 'Privado' });
            prisma.volume.create.mockResolvedValue(volume);
            const res = makeRes();

            await adminController.createVolume(makeReq({
                params: { editionId: '20' },
                body: volumeBody
            }), res);

            expect(prisma.volume.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    singleVolume: false,
                    priceCurrency: 'R$',
                    pages: null,
                    price: null
                })
            }));
            expect(res.status).toHaveBeenCalledWith(201);
        });

        it.each([
            ['Mes e ano', { releaseYear: 2025, releaseMonth: 7, releaseDay: 20 }, 7, null],
            ['Ano', { releaseYear: 2024, releaseMonth: 7, releaseDay: 20 }, null, null]
        ])('atualiza volume com precisao %s', async (precision, releaseFields, expectedMonth, expectedDay) => {
            prisma.volume.findUnique.mockResolvedValue({ id: 30 });
            prisma.volume.update.mockResolvedValue({
                ...volume,
                releaseDatePrecision: precision,
                releaseYear: releaseFields.releaseYear,
                releaseMonth: expectedMonth,
                releaseDay: expectedDay
            });
            const res = makeRes();

            await adminController.updateVolume(makeReq({
                params: { id: '30' },
                body: {
                    releaseDatePrecision: precision,
                    ...releaseFields
                }
            }), res);

            expect(prisma.volume.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    releaseMonth: expectedMonth,
                    releaseDay: expectedDay
                })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('exclui volume privado', async () => {
            prisma.volume.findUnique.mockResolvedValue({ id: 30, visibility: 'Privado' });
            prisma.volume.delete.mockResolvedValue({ id: 30 });
            const res = makeRes();

            await adminController.deleteVolume(makeReq({ params: { id: '30' } }), res);

            expect(prisma.volume.delete).toHaveBeenCalledWith({ where: { id: 30 } });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it.each([
            ['P2002', 'updateEdition', { params: { id: '20' }, body: { chronologicalNumber: 2 } }, () => {
                prisma.edition.findUnique.mockResolvedValue({ id: 20 });
                prisma.edition.update.mockRejectedValue({ code: 'P2002' });
            }],
            ['P2002', 'updateVolume', { params: { id: '30' }, body: { number: 2 } }, () => {
                prisma.volume.findUnique.mockResolvedValue({ id: 30 });
                prisma.volume.update.mockRejectedValue({ code: 'P2002' });
            }],
            ['P2025', 'deleteOption', { params: { id: '10' } }, () => {
                prisma.domainOptionValue.delete.mockRejectedValue({ code: 'P2025' });
            }]
        ])('trata conflito Prisma %s em %s', async (_code, handlerName, request, arrange) => {
            arrange();
            const res = makeRes();

            await adminController[handlerName](makeReq(request), res);

            expect([404, 409]).toContain(res.status.mock.calls[0][0]);
        });

        it('normaliza detalhe de obra com relacionamentos opcionais e papeis desconhecidos', async () => {
            prisma.work.findUnique.mockResolvedValue({
                id: 1,
                title: 'Obra mínima',
                originalTitle: null,
                originalPublicationStartYear: null,
                originalPublicationEndYear: null,
                originalVolumeCount: null,
                directRelease: true,
                visibility: 'Privado',
                adultContent: false,
                coverUrl: null,
                type: null,
                country: 'Japão',
                originalPublicationStatus: null,
                authors: [
                    { author: { id: 2, label: 'Zeta' } },
                    { author: { id: 1, label: 'Alfa' }, roles: [{ role: 'Papel legado' }] }
                ]
            });
            const res = makeRes();

            await adminController.getWorkById(makeReq({ params: { id: '1' } }), res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                work: expect.objectContaining({
                    type: null,
                    editionsCount: 0,
                    originalPublishers: [],
                    genres: [],
                    demographics: [],
                    serializationMagazines: [],
                    authors: [
                        expect.objectContaining({ author: { id: 1, label: 'Alfa' }, roles: ['Papel legado'] }),
                        expect.objectContaining({ author: { id: 2, label: 'Zeta' }, roles: [] })
                    ]
                })
            });
        });

        it.each([
            ['type', { type: { label: 'asc' } }],
            ['visibility', { visibility: 'asc' }]
        ])('ordena listagem de obras por %s', async (sortBy, expectedOrderBy) => {
            prisma.$transaction.mockResolvedValue([[], 0]);
            const res = makeRes();

            await adminController.listWorks(makeReq({ query: { sortBy } }), res);

            expect(prisma.work.findMany).toHaveBeenCalledWith(expect.objectContaining({
                orderBy: expectedOrderBy
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it.each([
            ['author', 'DESC'],
            ['editions', 'ASC']
        ])('ordena em memoria por %s', async (sortBy, order) => {
            const makeWork = (id, title, authorLabel, editionsCount) => ({
                id,
                title,
                originalTitle: null,
                visibility: 'Privado',
                adultContent: false,
                coverUrl: null,
                type: { id: 1, label: 'Mangá' },
                country: 'Japão',
                editionsCount,
                authors: authorLabel ? [{ author: { id, label: authorLabel }, roles: [] }] : []
            });
            prisma.$transaction.mockResolvedValue([
                [makeWork(1, 'A', 'Alfa', 2), makeWork(2, 'B', null, 10)],
                2
            ]);
            const res = makeRes();

            await adminController.listWorks(makeReq({ query: { sortBy, order } }), res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                works: expect.any(Array)
            }));
        });

        it('valida filtros e categoria ausente ao listar opcoes', async () => {
            const missingCategoryRes = makeRes();
            const invalidParamsRes = makeRes();
            const invalidQueryRes = makeRes();
            prisma.domainOptionCategory.findUnique.mockResolvedValue(null);

            await adminController.listOptions(makeReq({ params: {}, query: {} }), invalidParamsRes);
            await adminController.listOptions(makeReq({ params: { category: 'generos' }, query: { page: '0' } }), invalidQueryRes);
            await adminController.listOptions(makeReq({ params: { category: 'generos' }, query: {} }), missingCategoryRes);

            expect(invalidParamsRes.status).toHaveBeenCalledWith(400);
            expect(invalidQueryRes.status).toHaveBeenCalledWith(400);
            expect(missingCategoryRes.status).toHaveBeenCalledWith(404);
        });

        it('lista opcoes filtrando por termo e dependencia', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue({ id: 1, slug: 'autores', name: 'Autor' });
            prisma.$transaction.mockResolvedValue([[], 0]);
            const res = makeRes();

            await adminController.listOptions(makeReq({
                params: { category: 'autores' },
                query: { term: 'ura', dependsOn: '8', order: 'DESC' }
            }), res);

            expect(prisma.domainOptionValue.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    dependencies: { some: { dependsOnValueId: 8 } },
                    label: { contains: 'ura', mode: 'insensitive' }
                }),
                orderBy: { label: 'desc' }
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('rejeita pais relacionado inexistente ao cadastrar opcao', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue({ id: 1, slug: 'autores', name: 'Autor' });
            prisma.domainOptionValue.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            const res = makeRes();

            await adminController.createOption(makeReq({
                body: { category: 'autores', label: 'Autor novo', dependsOnValueIds: [999] }
            }), res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'País de origem relacionado inválido.' });
        });

        it('informa todos os valores existentes no cadastro em lote', async () => {
            prisma.domainOptionCategory.findUnique.mockResolvedValue({ id: 1, slug: 'generos', name: 'Gêneros' });
            prisma.domainOptionValue.findMany.mockResolvedValue([{ label: 'Drama' }, { label: 'Ação' }]);
            const res = makeRes();

            await adminController.createOption(makeReq({
                body: { category: 'generos', label: 'Drama, Ação' }
            }), res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Essa lista já tem esses valores cadastrados: Drama, Ação.'
            });
        });

        it.each([
            [{ ...volumeBody, releaseDatePrecision: 'Mes e ano', releaseMonth: undefined }],
            [{ ...volumeBody, releaseDatePrecision: 'Ano', releaseYear: undefined }]
        ])('rejeita data de publicacao incompleta do volume', async (body) => {
            const res = makeRes();

            await adminController.createVolume(makeReq({ params: { editionId: '20' }, body }), res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.edition.findUnique).not.toHaveBeenCalled();
        });

        it('rejeita vinculos duplicados e periodo invertido da obra', async () => {
            const duplicatedRes = makeRes();
            const periodRes = makeRes();
            const baseBody = {
                title: 'Teste',
                typeId: 1,
                country: 'Japão',
                originalPublicationStatus: 'Completo',
                authors: [{ authorId: 1, roles: ['História'] }]
            };

            await adminController.createWork(makeReq({
                body: { ...baseBody, genreIds: [2, 2] }
            }), duplicatedRes);
            await adminController.createWork(makeReq({
                body: {
                    ...baseBody,
                    originalPublicationStartYear: 2020,
                    originalPublicationEndYear: 2010
                }
            }), periodRes);

            expect(duplicatedRes.status).toHaveBeenCalledWith(400);
            expect(periodRes.status).toHaveBeenCalledWith(400);
        });

        it('rejeita obra ja cadastrada', async () => {
            prisma.work.findFirst.mockResolvedValue({ id: 99 });
            const res = makeRes();

            await adminController.createWork(makeReq({
                body: {
                    title: 'Repetida',
                    typeId: 1,
                    country: 'Japão',
                    originalPublicationStatus: 'Completo',
                    authors: [{ authorId: 1, roles: ['História'] }]
                }
            }), res);

            expect(res.status).toHaveBeenCalledWith(409);
        });

        it('exclui obra privada sem edicoes', async () => {
            prisma.work.findUnique.mockResolvedValue({ id: 1, visibility: 'Privado' });
            prisma.edition.count.mockResolvedValue(0);
            prisma.work.delete.mockReturnValue('deleteWorkQuery');
            prisma.$transaction.mockResolvedValue([{ id: 1 }]);
            const res = makeRes();

            await adminController.deleteWork(makeReq({ params: { id: '1' } }), res);

            expect(prisma.$transaction).toHaveBeenCalledWith(['deleteWorkQuery']);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it.each([
            ['Público', 'Privado', 0],
            ['Privado', 'Público', 0]
        ])('altera visibilidade da obra de %s para %s', async (currentVisibility, visibility, publicEditions) => {
            prisma.work.findUnique.mockResolvedValue({ id: 1, visibility: currentVisibility });
            prisma.edition.count.mockResolvedValue(publicEditions);
            prisma.work.update.mockResolvedValue({
                id: 1,
                title: 'Obra',
                originalTitle: null,
                originalPublicationStartYear: null,
                originalPublicationEndYear: null,
                originalVolumeCount: null,
                directRelease: false,
                visibility,
                adultContent: false,
                coverUrl: null,
                type: { id: 1, label: 'Mangá' },
                country: 'Japão',
                originalPublicationStatus: 'Completo',
                authors: [],
                genres: [],
                demographics: [],
                originalPublishers: [],
                serializationMagazines: []
            });
            const res = makeRes();

            await adminController.updateWorkVisibility(makeReq({
                params: { id: '1' },
                body: { visibility }
            }), res);

            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('atualiza campos isolados de data do volume', async () => {
            prisma.volume.findUnique.mockResolvedValue({ id: 30 });
            prisma.volume.update.mockResolvedValue(volume);
            const res = makeRes();

            await adminController.updateVolume(makeReq({
                params: { id: '30' },
                body: { releaseYear: 2024, releaseMonth: 2, releaseDay: 3 }
            }), res);

            expect(prisma.volume.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    releaseYear: 2024,
                    releaseMonth: 2,
                    releaseDay: 3
                })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('recusa alteracao de nivel sem usuario autenticado no request', async () => {
            const req = makeReq({ user: undefined, params: { id: 'user-2' }, body: { role: 'Administrador' } });
            const res = makeRes();

            await expect(adminController.updateUserRole(req, res)).rejects.toThrow(
                'Usuário autenticado não encontrado na requisição.'
            );
        });
    });
});
