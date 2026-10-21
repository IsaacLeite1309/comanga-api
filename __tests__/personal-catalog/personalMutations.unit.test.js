jest.mock('../../src/prisma',()=>({$transaction:jest.fn()}));
const prisma=require('../../src/prisma');
const mutations=require('../../src/modules/personal-catalog/mutations');
let tx;
const userId='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{
    tx={
        $queryRaw:jest.fn().mockResolvedValue([{id:userId}]),
        $executeRaw:jest.fn().mockResolvedValue(1),
        volume:{findFirst:jest.fn().mockResolvedValue({id:3}),count:jest.fn().mockResolvedValue(2)},
        edition:{findFirst:jest.fn().mockResolvedValue({id:2})},
        userVolume:{findUnique:jest.fn().mockResolvedValue(null),upsert:jest.fn().mockResolvedValue({}),updateMany:jest.fn().mockResolvedValue({count:1}),deleteMany:jest.fn().mockResolvedValue({count:1})}
    };
    prisma.$transaction.mockImplementation(operation=>operation(tx));
});
it('rejeita conta removida entre middleware e transação antes de escrever',async()=>{
    tx.$queryRaw.mockResolvedValue([]);
    await expect(mutations.addOwned(userId,3,false)).rejects.toMatchObject({statusCode:404,code:'PERSONAL_ITEM_NOT_FOUND'});
    expect(tx.userVolume.upsert).not.toHaveBeenCalled();
});
it('rejeita volume indisponível e propaga falhas de infraestrutura',async()=>{
    tx.volume.findFirst.mockResolvedValue(null);
    await expect(mutations.addOwned(userId,3,false)).rejects.toMatchObject({statusCode:404});
    const failure=new Error('database unavailable');tx.volume.findFirst.mockRejectedValue(failure);
    await expect(mutations.addWanted(userId,3,true)).rejects.toBe(failure);
    expect(tx.userVolume.upsert).not.toHaveBeenCalled();
});
it.each([null,{state:'Wanted',read:null},{state:'Owned',read:true}])('posse preserva leitura somente quando já é posse: %j',async current=>{
    tx.userVolume.findUnique.mockResolvedValue(current);
    expect(await mutations.addOwned(userId,3,true)).toEqual({volumeId:3,owned:true,read:current?.state==='Owned',wished:false});
});
it('desejo retorna conflito de negócio e não transforma posse existente',async()=>{
    tx.userVolume.findUnique.mockResolvedValue({state:'Owned',read:false});
    await expect(mutations.addWanted(userId,3,false)).rejects.toMatchObject({statusCode:409,code:'VOLUME_ALREADY_OWNED'});
    expect(tx.userVolume.upsert).not.toHaveBeenCalled();
});
it.each([null,{state:'Wanted',read:null}])('desejo não contém estado de leitura: %j',async current=>{
    tx.userVolume.findUnique.mockResolvedValue(current);
    const result=await mutations.addWanted(userId,3,false);
    expect(result).toEqual({volumeId:3,owned:false,wished:true});expect(result).not.toHaveProperty('read');
});
it('alteração leitura exige posse existente e propaga falhas',async()=>{
    expect(await mutations.updateRead(userId,3,false,false)).toMatchObject({read:false,owned:true});
    tx.userVolume.updateMany.mockResolvedValue({count:0});
    await expect(mutations.updateRead(userId,3,true,true)).rejects.toMatchObject({statusCode:404});
});
it('remoções mantêm escopo da conta e do tipo solicitado',async()=>{
    await mutations.removeItem(userId,3,'Wanted');
    expect(tx.userVolume.deleteMany).toHaveBeenCalledWith({where:{userId,volumeId:3,state:'Wanted'}});
});
it('lote inválido não inicia alterações',async()=>{
    tx.edition.findFirst.mockResolvedValue(null);
    await expect(mutations.syncOwned(userId,2,{addVolumeIds:[3],removeVolumeIds:[4]},false)).rejects.toMatchObject({statusCode:404});
    tx.edition.findFirst.mockResolvedValue({id:2});tx.volume.count.mockResolvedValue(1);
    await expect(mutations.syncOwned(userId,2,{addVolumeIds:[3],removeVolumeIds:[4]},false)).rejects.toMatchObject({statusCode:404});
    expect(tx.userVolume.deleteMany).not.toHaveBeenCalled();
});
it('lote mantém contexto edição e confirma todos IDs da operação',async()=>{
    expect(await mutations.syncOwned(userId,2,{addVolumeIds:[3],removeVolumeIds:[4]},true)).toEqual({editionId:2,addedVolumeIds:[3],removedVolumeIds:[4]});
    expect(tx.volume.count.mock.calls[0][0].where).toMatchObject({editionId:2,id:{in:[3,4]}});
});
