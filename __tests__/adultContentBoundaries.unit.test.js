const prisma = {
    session: {
        findFirst: jest.fn()
    }
};

jest.mock('../src/prisma', () => prisma);

const { isAdult, parseBirthDate } = require('../src/modules/auth/accountRules');
const { optionalSessionMiddleware } = require('../src/modules/auth');

const utc = (value) => new Date(`${value}T00:00:00.000Z`);

describe('maioridade no limite exato de 18 anos', () => {
    it.each([
        ['véspera do aniversário de 18 anos', '2008-09-21', '2026-09-20T12:00:00.000Z', false],
        ['dia do aniversário de 18 anos', '2008-09-20', '2026-09-20T12:00:00.000Z', true],
        ['dia seguinte ao aniversário de 18 anos', '2008-09-19', '2026-09-20T12:00:00.000Z', true],
        ['nascido em 29/02 avaliado em 28/02 de ano comum', '2008-02-29', '2026-02-28T12:00:00.000Z', false],
        ['nascido em 29/02 avaliado em 01/03 de ano comum', '2008-02-29', '2026-03-01T12:00:00.000Z', true],
        ['nascido em 29/02 avaliado em 29/02 do ano bissexto', '2008-02-29', '2028-02-29T12:00:00.000Z', true]
    ])('%s', (_descricao, birthDate, now, esperado) => {
        expect(isAdult(utc(birthDate), new Date(now))).toBe(esperado);
    });

    it.each([
        ['último instante do dia anterior em UTC', '2026-09-19T23:59:59.999Z', false],
        ['primeiro instante do dia do aniversário em UTC', '2026-09-20T00:00:00.000Z', true]
    ])('usa o calendário UTC, não o fuso do servidor: %s', (_descricao, now, esperado) => {
        // Com fuso local a Oeste de Greenwich os dois instantes caem no mesmo dia civil
        // e a maioridade passaria a depender de onde a API está hospedada.
        expect(isAdult(utc('2008-09-20'), new Date(now))).toBe(esperado);
    });

    it('recusa data de nascimento no futuro pela virada de dia em UTC', () => {
        const agora = new Date('2026-09-20T23:30:00.000Z');

        expect(parseBirthDate('2026-09-20', agora)).not.toBeNull();
        expect(parseBirthDate('2026-09-21', agora)).toBeNull();
    });
});

describe('resolução do visitante nas leituras públicas', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function mockSession(user) {
        prisma.session.findFirst.mockResolvedValue({ user });
    }

    async function resolveViewer(user) {
        mockSession(user);
        const req = { headers: { cookie: 'comanga_session=token-valido' } };
        const next = jest.fn();
        await optionalSessionMiddleware(req, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
        return req.publicCatalogViewer;
    }

    const maiorDeIdade = utc('2000-01-01');

    it('não libera conteúdo adulto para conta legada sem data de nascimento', async () => {
        expect(await resolveViewer({
            id: 'legado-1',
            status: 'Ativada',
            conteudoAdulto: true,
            birthDate: null
        })).toEqual({ userId: 'legado-1', canViewAdultContent: false, hasAdminAssignment: false });
    });

    it('não libera conteúdo adulto para quem ainda não completou 18 anos', async () => {
        const ontem = new Date();
        ontem.setUTCFullYear(ontem.getUTCFullYear() - 18);
        ontem.setUTCDate(ontem.getUTCDate() + 1);

        expect(await resolveViewer({
            id: 'menor-1',
            status: 'Ativada',
            conteudoAdulto: true,
            birthDate: ontem
        })).toEqual({ userId: 'menor-1', canViewAdultContent: false, hasAdminAssignment: false });
    });

    it('libera conteúdo adulto exatamente no dia em que a conta completa 18 anos', async () => {
        const hoje = new Date();
        hoje.setUTCFullYear(hoje.getUTCFullYear() - 18);

        expect(await resolveViewer({
            id: 'maior-1',
            status: 'Ativada',
            conteudoAdulto: true,
            birthDate: hoje
        })).toEqual({ userId: 'maior-1', canViewAdultContent: true, hasAdminAssignment: false });
    });

    it('respeita a preferência desligada mesmo em conta maior de idade', async () => {
        expect(await resolveViewer({
            id: 'preferencia-off',
            status: 'Ativada',
            conteudoAdulto: false,
            birthDate: maiorDeIdade
        })).toEqual({ userId: 'preferencia-off', canViewAdultContent: false, hasAdminAssignment: false });
    });

    it.each([['Pendente'], ['Bloqueada']])('não identifica o visitante em conta %s', async (status) => {
        expect(await resolveViewer({
            id: 'inativa-1',
            status,
            conteudoAdulto: true,
            birthDate: maiorDeIdade
        })).toEqual({ canViewAdultContent: false, hasAdminAssignment: false });
    });
});
