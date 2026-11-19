const accounts = require('../../scripts/load/accounts');
const catalog = require('../../scripts/load/catalog');

function fixtures() {
    return {
        password: 'SenhaDeTeste!123',
        users: { member: { email: 'membro@fixture.invalid', cookie: 'membro' }, admin: { cookie: 'admin' } },
        catalog: { volumeIds: [1, 2, 3, 4, 5, 6, 7, 8], editionId: 1 },
        createUser: jest.fn()
            .mockResolvedValueOnce({ id: 'u1', cookie: 'cookie1' })
            .mockResolvedValueOnce({ id: 'u2', cookie: 'cookie2' }),
        prisma: { userVolume: { deleteMany: jest.fn() } }
    };
}

describe('cenários da suíte de carga', () => {
    it('prepara o volume em cada inclusão e isola os membros por cliente', async () => {
        const data = fixtures();
        const wish = catalog.createScenarios(data).find(entry => entry.name === 'pessoal.edicao.adicionar-aos-desejos');
        const request = jest.fn().mockResolvedValue({ status: 200 });
        for (const workerId of [0, 1, 0]) await wish.run({ request, workerId, phase: 'load' });

        expect(data.createUser).toHaveBeenCalledTimes(2);
        expect(data.prisma.userVolume.deleteMany.mock.calls.map(([{ where }]) => where)).toEqual([
            { userId: 'u1', volumeId: 7 }, { userId: 'u2', volumeId: 7 }, { userId: 'u1', volumeId: 7 }
        ]);
        expect(request.mock.calls.map(([{ cookie }]) => cookie)).toEqual(['cookie1', 'cookie2', 'cookie1']);
    });

    it.each([false, true])('seleciona os cadastros presentes na API (v1 presente: %s)', hasVersioned => {
        const versioned = 'POST /api/auth/register/v1';
        const module = accounts.forEndpoints(hasVersioned ? [versioned] : []);
        const cases = module.createScenarios(fixtures());
        expect(module.routes.some(route => route.path === '/api/auth/register/v1')).toBe(hasVersioned);
        expect(cases.some(entry => entry.endpoint === versioned)).toBe(hasVersioned);
        expect(cases.some(entry => entry.endpoint === 'POST /api/auth/register')).toBe(true);
    });
});
