const {batchSchema,paginationSchema,volumeParamsSchema,editionParamsSchema,readSchema}=require('../src/modules/personal-catalog/schemas');

describe('contratos de entrada do acervo pessoal',()=>{
    it.each([
        [{addVolumeIds:[],removeVolumeIds:[]},true],
        [{addVolumeIds:[1,2],removeVolumeIds:[3]},true],
        [{addVolumeIds:[1,1],removeVolumeIds:[]},false],
        [{addVolumeIds:[1],removeVolumeIds:[1]},false],
        [{addVolumeIds:[0],removeVolumeIds:[]},false],
        [{addVolumeIds:[1.5],removeVolumeIds:[]},false],
        [{addVolumeIds:['1'],removeVolumeIds:[]},false],
        [{addVolumeIds:[2147483648],removeVolumeIds:[]},false],
        [{addVolumeIds:[],removeVolumeIds:[],userId:'outro'},false],
        [{addVolumeIds:Array.from({length:100},(_,i)=>i+1),removeVolumeIds:[]},true],
        [{addVolumeIds:Array.from({length:51},(_,i)=>i+1),removeVolumeIds:Array.from({length:50},(_,i)=>i+60)},false]
    ])('valida delta sem truncar: %j',(body,valid)=>{
        expect(batchSchema.safeParse(body).success).toBe(valid);
    });
    it.each([{}, {page:'1',limit:'50'}, {page:'2147483647',limit:'1'}])('aceita paginação %j',input=>{
        expect(paginationSchema.safeParse(input).success).toBe(true);
    });
    it.each([{page:'0'},{limit:'51'},{page:'1.1'},{page:['1','2']},{limit:true},{page:'2147483647',limit:'2'},{limit:'1e1'},{userId:'outro'}])('rejeita paginação %j',input=>{
        expect(paginationSchema.safeParse(input).success).toBe(false);
    });
    it('parâmetros aceitam apenas inteiros positivos representáveis no banco',()=>{
        expect(volumeParamsSchema.parse({volumeId:'23'})).toEqual({volumeId:23});
        expect(editionParamsSchema.parse({editionId:'23'})).toEqual({editionId:23});
        for(const volumeId of ['-1','0','1.2','2147483648','1e2',' 1',true])expect(volumeParamsSchema.safeParse({volumeId}).success).toBe(false);
    });
    it('leitura aceita booleano literal e impede identidade fornecida pelo cliente',()=>{
        expect(readSchema.parse({read:false})).toEqual({read:false});
        expect(readSchema.safeParse({read:'false'}).success).toBe(false);
        expect(readSchema.safeParse({read:true,userId:'outro'}).success).toBe(false);
    });
});
