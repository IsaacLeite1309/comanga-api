const bcrypt = require('bcrypt');

const prisma = {
    user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
    },
    session: {
        create: jest.fn(),
        updateMany: jest.fn()
    },
    $transaction: jest.fn()
};

const mailer = {
    sendActivationEmail: jest.fn()
};

jest.mock('../src/prisma', () => prisma);
jest.mock('../src/utils/mailer', () => mailer);

const userController = require('../src/controllers/userController');

function makeRes() {
    const res = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        cookie: jest.fn(() => res),
        clearCookie: jest.fn(() => res)
    };

    return res;
}

function makeReq(overrides = {}) {
    return {
        body: {},
        params: {},
        headers: {},
        user: undefined,
        session: undefined,
        ...overrides
    };
}

describe('userController unitario', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
        jest.restoreAllMocks();
    });

    describe('registerUser', () => {
        const validBody = {
            username: 'usuario_teste',
            email: 'usuario@teste.local',
            password: 'SenhaForte123!',
            confirmPassword: 'SenhaForte123!'
        };

        it('rejeita payload invalido antes de consultar o banco', async () => {
            const req = makeReq({ body: { ...validBody, username: 'x' } });
            const res = makeRes();

            await userController.registerUser(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.user.findFirst).not.toHaveBeenCalled();
        });

        it('rejeita e-mail duplicado', async () => {
            prisma.user.findFirst.mockResolvedValue({ email: validBody.email, username: 'outro' });
            const req = makeReq({ body: validBody });
            const res = makeRes();

            await userController.registerUser(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ field: 'email' }));
        });

        it('rejeita username duplicado', async () => {
            prisma.user.findFirst.mockResolvedValue({ email: 'outro@teste.local', username: validBody.username });
            const req = makeReq({ body: validBody });
            const res = makeRes();

            await userController.registerUser(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ field: 'username' }));
        });

        it('cria conta e informa quando o e-mail falha', async () => {
            prisma.user.findFirst.mockResolvedValue(null);
            prisma.user.create.mockResolvedValue({});
            mailer.sendActivationEmail.mockRejectedValue(new Error('SMTP off'));
            const req = makeReq({ body: validBody });
            const res = makeRes();

            await userController.registerUser(req, res);

            expect(prisma.user.create).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ email_sent: false }));
        });

        it('cria conta e envia e-mail de ativacao', async () => {
            prisma.user.findFirst.mockResolvedValue(null);
            prisma.user.create.mockResolvedValue({});
            mailer.sendActivationEmail.mockResolvedValue();
            const req = makeReq({ body: validBody });
            const res = makeRes();

            await userController.registerUser(req, res);

            expect(mailer.sendActivationEmail).toHaveBeenCalledWith(
                validBody.email,
                validBody.username,
                expect.any(String)
            );
            expect(res.status).toHaveBeenCalledWith(201);
        });

        it('traduz conflito UNIQUE concorrente do Prisma para HTTP 409', async () => {
            prisma.user.findFirst.mockResolvedValue(null);
            prisma.user.create.mockRejectedValue({
                code: 'P2002',
                meta: { target: ['email'] }
            });
            const req = makeReq({ body: validBody });
            const res = makeRes();

            await userController.registerUser(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Este endereço de e-mail já está em uso. Tente fazer login ou recuperar sua senha.',
                field: 'email'
            });
            expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
        });

        it('identifica username no conflito UNIQUE concorrente do Prisma', async () => {
            prisma.user.findFirst.mockResolvedValue(null);
            prisma.user.create.mockRejectedValue({
                code: 'P2002',
                meta: { target: ['username'] }
            });
            const req = makeReq({ body: validBody });
            const res = makeRes();

            await userController.registerUser(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Este nome de usuário não está disponível. Por favor, escolha outro.',
                field: 'username'
            });
            expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
        });
    });

    describe('activateAccount', () => {
        it('ativa conta quando o token existe e esta valido', async () => {
            const tx = {
                user: {
                    findFirst: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        activationExpiresAt: new Date(Date.now() + 1000)
                    }),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 })
                }
            };
            prisma.$transaction.mockImplementation((callback) => callback(tx));
            const req = makeReq({ params: { token: 'token-valido' } });
            const res = makeRes();

            await userController.activateAccount(req, res);

            expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ id: 'user-1', activationToken: 'token-valido' }),
                data: expect.objectContaining({ status: 'Ativada', activationToken: null })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('rejeita token perdido em corrida concorrente quando nenhuma linha e atualizada', async () => {
            prisma.$transaction.mockImplementation((callback) => callback({
                user: {
                    findFirst: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        activationExpiresAt: new Date(Date.now() + 1000)
                    }),
                    updateMany: jest.fn().mockResolvedValue({ count: 0 })
                }
            }));
            const req = makeReq({ params: { token: 'token-concorrente' } });
            const res = makeRes();

            await userController.activateAccount(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Link de ativação inválido!' });
        });

        it('rejeita token inexistente', async () => {
            prisma.$transaction.mockImplementation((callback) => callback({
                user: {
                    findFirst: jest.fn().mockResolvedValue(null)
                }
            }));
            const req = makeReq({ params: { token: 'invalido' } });
            const res = makeRes();

            await userController.activateAccount(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Link de ativação inválido!' });
        });

        it('rejeita token expirado', async () => {
            prisma.$transaction.mockImplementation((callback) => callback({
                user: {
                    findFirst: jest.fn().mockResolvedValue({
                        id: 'user-1',
                        activationExpiresAt: new Date(Date.now() - 1000)
                    })
                }
            }));
            const req = makeReq({ params: { token: 'expirado' } });
            const res = makeRes();

            await userController.activateAccount(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('resendActivation', () => {
        it('exige e-mail no corpo da requisicao', async () => {
            const res = makeRes();

            await userController.resendActivation(makeReq(), res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejeita e-mail inexistente', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const res = makeRes();

            await userController.resendActivation(makeReq({ body: { email: 'nao@existe.local' } }), res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('rejeita conta ja ativada', async () => {
            prisma.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'isaac', status: 'Ativada' });
            const res = makeRes();

            await userController.resendActivation(makeReq({ body: { email: 'user@teste.local' } }), res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejeita reenvio para conta bloqueada', async () => {
            prisma.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'isaac', status: 'Bloqueada' });
            const res = makeRes();

            await userController.resendActivation(makeReq({ body: { email: 'user@teste.local' } }), res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Somente contas pendentes podem solicitar um novo link de ativação.'
            });
            expect(prisma.user.update).not.toHaveBeenCalled();
            expect(mailer.sendActivationEmail).not.toHaveBeenCalled();
        });

        it('renova token e envia novo e-mail', async () => {
            prisma.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'isaac', status: 'Pendente' });
            prisma.user.update.mockResolvedValue({});
            mailer.sendActivationEmail.mockResolvedValue();
            const res = makeRes();

            await userController.resendActivation(makeReq({ body: { email: 'user@teste.local' } }), res);

            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'user-1' },
                data: expect.objectContaining({ activationToken: expect.any(String) })
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('retorna erro quando o SMTP falha no reenvio', async () => {
            prisma.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'isaac', status: 'Pendente' });
            prisma.user.update.mockResolvedValue({});
            mailer.sendActivationEmail.mockRejectedValue(new Error('SMTP off'));
            const res = makeRes();

            await userController.resendActivation(makeReq({ body: { email: 'user@teste.local' } }), res);

            expect(res.status).toHaveBeenCalledWith(502);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Erro ao tentar enviar o e-mail.',
                code: 'ACTIVATION_EMAIL_DELIVERY_FAILED'
            });
        });
    });

    describe('loginUser', () => {
        it('exige e-mail e senha', async () => {
            const res = makeRes();

            await userController.loginUser(makeReq({ body: { email: 'user@teste.local' } }), res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejeita usuario inexistente', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const res = makeRes();

            await userController.loginUser(makeReq({ body: { email: 'user@teste.local', password: 'senha' } }), res);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('rejeita senha invalida', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                username: 'isaac',
                passwordHash: 'hash',
                status: 'Ativada',
                nivelAcesso: 'Usuário Padrão'
            });
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);
            const res = makeRes();

            await userController.loginUser(makeReq({ body: { email: 'user@teste.local', password: 'errada' } }), res);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('bloqueia conta pendente', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                username: 'isaac',
                passwordHash: 'hash',
                status: 'Pendente',
                nivelAcesso: 'Usuário Padrão'
            });
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
            const res = makeRes();

            await userController.loginUser(makeReq({ body: { email: 'user@teste.local', password: 'correta' } }), res);

            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('bloqueia conta bloqueada', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                username: 'isaac',
                passwordHash: 'hash',
                status: 'Bloqueada',
                nivelAcesso: 'Usuário Padrão'
            });
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
            const res = makeRes();

            await userController.loginUser(makeReq({ body: { email: 'user@teste.local', password: 'correta' } }), res);

            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('cria sessao stateful e grava cookie', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                username: 'isaac',
                passwordHash: 'hash',
                status: 'Ativada',
                nivelAcesso: 'Usuário Padrão'
            });
            prisma.session.create.mockResolvedValue({});
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
            const req = makeReq({ body: { email: 'user@teste.local', password: 'correta' } });
            const res = makeRes();

            await userController.loginUser(req, res);

            expect(prisma.session.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'user-1', sessionTokenHash: expect.any(String) })
            }));
            expect(res.cookie).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('perfil e preferencias', () => {
        it('retorna perfil autenticado em /api/auth/me', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                username: 'isaac',
                email: 'user@teste.local',
                conteudoAdulto: false,
                nivelAcesso: 'Usuário Padrão'
            });
            const req = makeReq({ user: { userId: 'user-1' } });
            const res = makeRes();

            await userController.getUserProfile(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                user: expect.objectContaining({ conteudo_adulto: false })
            }));
        });

        it('retorna 404 quando perfil autenticado nao existe em /api/auth/me', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const req = makeReq({ user: { userId: 'user-1' } });
            const res = makeRes();

            await userController.getUserProfile(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('retorna perfil autenticado em /api/users/me', async () => {
            prisma.user.findUnique.mockResolvedValue({
                username: 'isaac',
                email: 'user@teste.local',
                conteudoAdulto: true
            });
            const req = makeReq({ user: { userId: 'user-1' } });
            const res = makeRes();

            await userController.getOwnUserProfile(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                user: expect.objectContaining({ conteudo_adulto: true })
            }));
        });

        it('retorna 404 quando perfil autenticado nao existe em /api/users/me', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const req = makeReq({ user: { userId: 'user-1' } });
            const res = makeRes();

            await userController.getOwnUserProfile(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('bloqueia IDOR para usuario padrao em getUserById', async () => {
            const req = makeReq({
                params: { id: 'user-2' },
                user: { userId: 'user-1', role: 'Usuário Padrão' }
            });
            const res = makeRes();

            await userController.getUserById(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('permite administrador consultar usuario por id', async () => {
            prisma.user.findUnique.mockResolvedValue({
                username: 'isaac',
                email: 'user@teste.local',
                conteudoAdulto: false,
                status: 'Ativada',
                nivelAcesso: 'Usuário Padrão'
            });
            const req = makeReq({
                params: { id: 'user-2' },
                user: { userId: 'admin-1', role: 'Administrador' }
            });
            const res = makeRes();

            await userController.getUserById(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('retorna 404 quando usuario consultado por id nao existe', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const req = makeReq({
                params: { id: 'user-2' },
                user: { userId: 'admin-1', role: 'Administrador' }
            });
            const res = makeRes();

            await userController.getUserById(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('valida tipo booleano na preferencia +18', async () => {
            const res = makeRes();

            await userController.updateAdultContent(makeReq({ body: { conteudo_adulto: 'sim' } }), res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('atualiza preferencia +18 do usuario autenticado', async () => {
            prisma.user.update.mockResolvedValue({ conteudoAdulto: true });
            const req = makeReq({
                body: { conteudo_adulto: true },
                user: { userId: 'user-1' }
            });
            const res = makeRes();

            await userController.updateAdultContent(req, res);

            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'user-1' },
                data: { conteudoAdulto: true }
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('retorna 404 quando usuario da preferencia +18 nao existe mais', async () => {
            prisma.user.update.mockRejectedValue({ code: 'P2025' });
            const req = makeReq({
                body: { conteudo_adulto: true },
                user: { userId: 'user-1' }
            });
            const res = makeRes();

            await userController.updateAdultContent(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('bloqueia IDOR para usuario padrao em updateUserById', async () => {
            const req = makeReq({
                params: { id: 'user-2' },
                user: { userId: 'user-1', role: 'Usuário Padrão' }
            });
            const res = makeRes();

            await userController.updateUserById(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('permite atualizacao generica quando usuario padrao acessa o proprio id', async () => {
            const req = makeReq({
                params: { id: 'user-1' },
                user: { userId: 'user-1', role: 'Usuário Padrão' }
            });
            const res = makeRes();

            await userController.updateUserById(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('logoutUser', () => {
        it('revoga sessao e limpa cookie', async () => {
            prisma.session.updateMany.mockResolvedValue({ count: 1 });
            const req = makeReq({ session: { id: 10, tokenHash: 'hash' } });
            const res = makeRes();

            await userController.logoutUser(req, res);

            expect(prisma.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 10, revokedAt: null },
                data: { revokedAt: expect.any(Date) }
            }));
            expect(res.clearCookie).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('deleteOwnAccount', () => {
        it('exige senha atual no corpo da requisicao', async () => {
            const req = makeReq({ user: { userId: 'user-1' } });
            const res = makeRes();

            await userController.deleteOwnAccount(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(prisma.user.findUnique).not.toHaveBeenCalled();
            expect(prisma.user.delete).not.toHaveBeenCalled();
        });

        it('rejeita exclusao quando a senha atual esta incorreta', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                passwordHash: 'hash-salvo'
            });
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);
            const req = makeReq({
                body: { currentPassword: 'senha-errada' },
                user: { userId: 'user-1' }
            });
            const res = makeRes();

            await userController.deleteOwnAccount(req, res);

            expect(bcrypt.compare).toHaveBeenCalledWith('senha-errada', 'hash-salvo');
            expect(prisma.user.delete).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Senha atual incorreta!' });
        });

        it('remove fisicamente o usuario autenticado e limpa o cookie da sessao', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                passwordHash: 'hash-salvo'
            });
            prisma.user.delete.mockResolvedValue({});
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
            const req = makeReq({
                body: { currentPassword: 'SenhaForte123!' },
                user: { userId: 'user-1' }
            });
            const res = makeRes();

            await userController.deleteOwnAccount(req, res);

            expect(prisma.user.delete).toHaveBeenCalledWith({
                where: { id: 'user-1' }
            });
            expect(res.clearCookie).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ message: 'Conta excluida permanentemente.' });
        });

        it('retorna 404 quando o usuario autenticado nao existe mais', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const req = makeReq({
                body: { currentPassword: 'SenhaForte123!' },
                user: { userId: 'user-1' }
            });
            const res = makeRes();

            await userController.deleteOwnAccount(req, res);

            expect(prisma.user.delete).not.toHaveBeenCalled();
            expect(res.clearCookie).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(404);
        });
    });
});
