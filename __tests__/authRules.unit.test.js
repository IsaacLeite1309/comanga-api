const { parseBirthDate, isAdult, passwordSchema } = require('../src/modules/auth/accountRules');
const { safeRequestPath } = require('../src/middlewares/requestLogger');

describe('datas privadas e logs seguros', () => {
    const today = new Date('2026-09-09T12:00:00Z');
    it.each(['', '2026-02-30', '2025-02-29', '2026-09-10', '2000-1-01', '0000-01-01', null])('recusa data inválida %s', value => {
        expect(parseBirthDate(value, today)).toBeNull();
    });
    it('aceita dia bissexto e calcula aniversário completo em UTC', () => {
        expect(parseBirthDate('2000-02-29', today).toISOString()).toBe('2000-02-29T00:00:00.000Z');
        expect(isAdult(new Date('2008-09-09'), today)).toBe(true);
        expect(isAdult(new Date('2008-09-10'), today)).toBe(false);
        expect(isAdult(null, today)).toBe(false);
        expect(isAdult(new Date('invalid'), today)).toBe(false);
    });
    it.each(['/api/auth/activate/secret?token=secret', '/api/auth/%61ctivate/secret', '/API/AUTH/ACTIVATE/secret', '/unknown/secret?password=secret'])('nunca registra partes fornecidas da URL %s', url => {
        expect(safeRequestPath({ originalUrl: url })).not.toContain('secret');
    });
    it('mantém somente o template da rota para diagnóstico', () => {
        expect(safeRequestPath({ baseUrl: '/api/auth', route: { path: '/activate/:token' } })).toBe('/api/auth/activate/:token');
    });
});

describe('contratos de criação e alteração de capas', () => {
    const { createWorkSchema, editionPayloadSchema, updateWorkSchema, updateEditionSchema, updateVolumeSchema } = require('../src/modules/admin/schemas');
    const asset = '7f28c7f0-c94f-46e8-b61c-6ea716f8f28e';
    const work = { title: 'Obra', typeId: 1, country: 'Japão', originalPublicationStatus: 'Completo', authors: [{ authorId: 1, roles: ['História e Arte'] }] };
    const edition = { brazilianPublisherId: 1, editionTypeId: 2, coverTypeId: 3, formatId: 4, chronologicalNumber: 1, brazilPublicationStatus: 'Completo' };
    it.each([[createWorkSchema, work], [editionPayloadSchema, edition]])('exige capa válida na criação', (schema, data) => {
        for (const value of [undefined, null, '', 'invalid']) expect(schema.safeParse({ ...data, coverAssetId: value }).success).toBe(false);
        expect(schema.safeParse({ ...data, coverAssetId: asset }).success).toBe(true);
    });
    it.each([[updateWorkSchema, { title: 'Novo título' }], [updateEditionSchema, { chronologicalNumber: 2 }], [updateVolumeSchema, { pages: 120 }]])('preserva capa omitida e recusa remoção explícita', (schema, data) => {
        expect(schema.safeParse(data).success).toBe(true);
        expect(schema.safeParse({ ...data, coverAssetId: null }).success).toBe(false);
        expect(schema.safeParse({ ...data, coverAssetId: '' }).success).toBe(false);
        expect(schema.safeParse({ ...data, coverAssetId: asset }).success).toBe(true);
    });
});

describe('limite da senha antes do bcrypt', () => {
    it.each([
        ['A1!' + 'a'.repeat(69), true],
        ['A1!' + 'a'.repeat(70), false],
        ['Aa1!' + 'é'.repeat(34), true],
        ['Aa1!' + 'é'.repeat(35), false],
        ['Aa1!' + '😀'.repeat(17), true],
        ['Aa1!' + '😀'.repeat(18), false]
    ])('valida bytes UTF-8: %s', (password, valid) => {
        expect(passwordSchema.safeParse(password).success).toBe(valid);
    });
});
