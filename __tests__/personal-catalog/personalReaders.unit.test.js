process.env.MEDIA_PUBLIC_BASE_URL='https://media.example.test';
jest.mock('../../src/prisma',()=>({$transaction:jest.fn()}));
const prisma=require('../../src/prisma');
const {listCollection,getEditionSelection,listWishlist}=require('../../src/modules/personal-catalog/readers');
const userId='00000000-0000-4000-8000-000000000001';
const work={id:1,slug:'obra',title:'Obra',coverAsset:null};
const edition={id:2,chronologicalNumber:1,brazilPublicationStatus:'Completa',brazilianPublisher:{id:4,label:'Editora'},work};
const volume={id:3,number:1,singleVolume:false,coverAsset:null};
let tx;
beforeEach(()=>{
    tx={
        edition:{findMany:jest.fn().mockResolvedValue([]),count:jest.fn().mockResolvedValue(0),findFirst:jest.fn().mockResolvedValue(edition)},
        volume:{findMany:jest.fn().mockResolvedValue([])},
        userVolume:{findMany:jest.fn().mockResolvedValue([]),count:jest.fn().mockResolvedValue(0)},
        $queryRaw:jest.fn().mockResolvedValue([])
    };
    prisma.$transaction.mockImplementation(operation=>operation(tx));
});
it('coleção vazia mantém paginação e não agrega catálogo sem edições',async()=>{
    expect(await listCollection(userId,false,{page:2,limit:12})).toEqual({works:[],totals:{editions:0,volumes:0},pagination:{page:2,limit:12,total:0,totalPages:0}});
    expect(tx.$queryRaw).not.toHaveBeenCalled();
});
it('filtra a coleção antes da paginação e usa os mesmos critérios na contagem',async()=>{
    await listCollection(userId,false,{page:1,limit:12,term:'Monster',status:'incomplete',brazilianPublisherId:4});
    const where=tx.edition.findMany.mock.calls[0][0].where;
    expect(tx.edition.count).toHaveBeenCalledWith({where});
    expect(where).toMatchObject({
        brazilianPublisherId:4,
        volumes:{some:{visibility:'Público',userVolumes:{some:{userId,state:'Owned'}}}},
        OR:[{brazilPublicationStatus:{notIn:['Completa','Cancelada']}},{volumes:{some:{visibility:'Público',userVolumes:{none:{userId,state:'Owned'}}}}}]
    });
    expect(where.work.OR).toContainEqual({title:{contains:'Monster',mode:'insensitive'}});
    expect(where.work.OR).toContainEqual({authors:{some:{author:{label:{contains:'Monster',mode:'insensitive'}}}}});
    jest.clearAllMocks();
    await listCollection(userId,false,{page:1,limit:12,status:'complete'});
    expect(tx.edition.findMany.mock.calls[0][0].where).toMatchObject({
        brazilPublicationStatus:{in:['Completa','Cancelada']},
        AND:[{volumes:{none:{visibility:'Público',userVolumes:{none:{userId,state:'Owned'}}}}}]
    });
});
it('agrupa edições da mesma obra e conserva progresso por edição',async()=>{
    tx.edition.findMany.mockResolvedValue([
        {...edition,volumes:[{...volume,userVolumes:[{read:true}]}]},
        {...edition,id:5,chronologicalNumber:2,volumes:[]},
        {...edition,id:8,work:{...work,id:9},volumes:[]}
    ]);
    tx.edition.count.mockResolvedValue(3);
    tx.$queryRaw.mockResolvedValue([{editionId:2,owned:1,total:3,read:1,wished:1},{editionId:5,owned:0,total:1,read:0,wished:0}]);
    const result=await listCollection(userId,true,{page:1,limit:12});
    expect(result.works).toHaveLength(2);expect(result.works[0].editions).toHaveLength(2);
    expect(result.works[0].editions[0].progress).toEqual({owned:1,total:3,read:1,wished:1});
    expect(result.works[0].editions[0].volumes).toEqual([{id:3,number:1,singleVolume:false,coverUrl:null,read:true}]);
    expect(result.works[1].editions[0].progress).toEqual({owned:0,total:0,read:0,wished:0});
});
it('seleção sem volumes ou vínculos retorna zero sem inventar posse',async()=>{
    const result=await getEditionSelection(userId,2,false,{page:1,limit:50});
    expect(result.volumes).toEqual([]);expect(result.progress).toEqual({owned:0,total:0,read:0,wished:0});
    expect(result.pagination).toEqual({page:1,limit:50,total:0,totalPages:0});
});
it('seleção deriva cada estado e mantém leitura ausente para intenção',async()=>{
    tx.volume.findMany.mockResolvedValue([
        {...volume,userVolumes:[{state:'Owned',read:false}]},
        {...volume,id:4,userVolumes:[{state:'Wanted',read:null}]},
        {...volume,id:5,userVolumes:[]}
    ]);
    tx.$queryRaw.mockResolvedValue([{editionId:2,owned:1,total:3,read:0,wished:1}]);
    const result=await getEditionSelection(userId,2,true,{page:1,limit:12});
    expect(result.volumes[0]).toMatchObject({owned:true,wished:false,read:false});
    expect(result.volumes[1]).toMatchObject({owned:false,wished:true,read:null});
    expect(result.volumes[2]).toMatchObject({owned:false,wished:false,read:null});
});
it('seleção não enumera Edição indisponível',async()=>{
    tx.edition.findFirst.mockResolvedValue(null);
    await expect(getEditionSelection(userId,2,false,{page:1,limit:12})).rejects.toMatchObject({statusCode:404,code:'PERSONAL_ITEM_NOT_FOUND'});
    expect(tx.volume.findMany).not.toHaveBeenCalled();
});
it('desejos só expõem dados públicos essenciais sem leitura ou identificação de conta',async()=>{
    tx.userVolume.findMany.mockResolvedValue([{volume:{...volume,affiliateLink:null,edition}}]);tx.userVolume.count.mockResolvedValue(1);
    const result=await listWishlist(userId,false,{page:1,limit:12});
    expect(result.volumes[0]).toEqual({id:3,number:1,singleVolume:false,coverUrl:null,affiliateLink:null,work:{id:1,slug:'obra',title:'Obra',coverUrl:null},edition:{id:2,chronologicalNumber:1,brazilPublicationStatus:'Completa',brazilianPublisher:{id:4,label:'Editora'}}});
    expect(result.pagination.total).toBe(1);
});
it('filtra desejos por título ou autor e editora antes da paginação',async()=>{
    tx.userVolume.findMany.mockResolvedValue([{volume:{...volume,affiliateLink:'https://amazon.example.test/item',edition}}]);
    const result=await listWishlist(userId,false,{page:2,limit:12,term:'Monster',brazilianPublisherId:4,order:'DESC'});
    const query=tx.userVolume.findMany.mock.calls[0][0];
    expect(query.orderBy[0]).toEqual({volume:{edition:{work:{title:'desc'}}}});
    expect(query.orderBy.slice(1)).toEqual([
        {volume:{edition:{workId:'asc'}}},
        {volume:{edition:{chronologicalNumber:'asc'}}},
        {volume:{number:'asc'}},
        {volumeId:'asc'}
    ]);
    expect(tx.userVolume.count).toHaveBeenCalledWith({where:query.where});
    expect(query.where.volume.edition.brazilianPublisherId).toBe(4);
    expect(query.where.volume.edition.work.OR).toContainEqual({title:{contains:'Monster',mode:'insensitive'}});
    expect(query.where.volume.edition.work.OR).toContainEqual({authors:{some:{author:{label:{contains:'Monster',mode:'insensitive'}}}}});
    expect(query.skip).toBe(12);
    expect(result.volumes[0].affiliateLink).toBe('https://amazon.example.test/item');
});
it('falhas de consulta propagam sem retornar resposta parcial',async()=>{
    const failure=new Error('database unavailable');tx.userVolume.count.mockRejectedValue(failure);
    await expect(listWishlist(userId,false,{page:1,limit:12})).rejects.toBe(failure);
});
