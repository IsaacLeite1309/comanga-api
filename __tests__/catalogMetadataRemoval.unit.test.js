const { editionPayloadSchema, updateEditionSchema, updateWorkSchema } = require('../src/modules/catalog/schemas');

describe('simplificação dos metadados do catálogo', () => {
    const required = { brazilianPublisherId: 1, chronologicalNumber: 1, brazilPublicationStatus: 'Completa' };

    it.each(Array.from({ length: 8 }, (_, bits) => [
        bits & 1 ? 2 : null, bits & 2 ? 3 : null, bits & 4 ? 4 : null
    ]))('aceita acabamento %s, formato %s e miolo %s sem Tipo de Edição', (coverTypeId, formatId, paperId) => {
        const payload = { ...required, coverTypeId, formatId, paperId };
        expect(editionPayloadSchema.safeParse(payload).success).toBe(true);
        expect(updateEditionSchema.safeParse({ coverTypeId, formatId, paperId }).success).toBe(true);
    });

    it('rejeita os campos removidos dos contratos de escrita', () => {
        expect(updateWorkSchema.safeParse({ originalVolumeCount: 3 }).success).toBe(false);
        expect(updateEditionSchema.safeParse({ editionTypeId: 2 }).success).toBe(false);
    });

    it.each(['coverTypeId', 'formatId', 'paperId'])('mantém validação do metadado opcional %s', (field) => {
        expect(updateEditionSchema.safeParse({ [field]: -1 }).success).toBe(false);
        expect(updateEditionSchema.safeParse({ [field]: null }).success).toBe(true);
    });
});
