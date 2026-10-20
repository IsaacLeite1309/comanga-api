jest.mock('../src/modules/personal-catalog/mutations',()=>({addOwned:jest.fn(),addWanted:jest.fn(),removeItem:jest.fn(),syncOwned:jest.fn(),updateRead:jest.fn()}));
jest.mock('../src/modules/personal-catalog/readers',()=>({listCollection:jest.fn(),getEditionSelection:jest.fn(),listWishlist:jest.fn()}));
const mutations=require('../src/modules/personal-catalog/mutations');
const readers=require('../src/modules/personal-catalog/readers');
const handlers=require('../src/modules/personal-catalog');
let req,res,next;
beforeEach(()=>{
    req={user:{userId:'own-account'},params:{volumeId:'3',editionId:'2'},query:{},body:{read:true},publicCatalogViewer:{canViewAdultContent:false,hasAdminAssignment:false}};
    res={vary:jest.fn(),set:jest.fn(),status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis(),end:jest.fn().mockReturnThis()};
    next=jest.fn();
    for(const operation of [...Object.values(mutations),...Object.values(readers)])operation.mockResolvedValue({ok:true});
});
it.each(['putOwned','putWanted','deleteOwned','deleteWanted','getCollection','getWishlist','getSelection'])('%s usa conta autenticada e cache privado',async name=>{
    await handlers[name](req,res,next);
    expect(next).not.toHaveBeenCalled();expect(res.vary).toHaveBeenCalledWith('Cookie');expect(res.set).toHaveBeenCalledWith('Cache-Control','private, no-store');
    if(name.startsWith('delete')){expect(res.status).toHaveBeenCalledWith(204);expect(res.end).toHaveBeenCalled();}
    else expect(res.status).toHaveBeenCalledWith(200);
});
it('update leitura e sincronização usam booleano e delta validados',async()=>{
    await handlers.patchRead(req,res,next);expect(mutations.updateRead).toHaveBeenCalledWith('own-account',3,true,false);
    req.body={addVolumeIds:[3],removeVolumeIds:[]};await handlers.putEdition(req,res,next);
    expect(mutations.syncOwned).toHaveBeenCalledWith('own-account',2,req.body,false);
});
it('sem contexto autenticado não consulta dados',async()=>{
    delete req.user;await handlers.getCollection(req,res,next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({statusCode:401}));expect(readers.listCollection).not.toHaveBeenCalled();
});
it('valida e encaminha os filtros da coleção',async()=>{
    req.query={page:'2',term:'  Monster  ',status:'complete',brazilianPublisherId:'4'};
    await handlers.getCollection(req,res,next);
    expect(readers.listCollection).toHaveBeenCalledWith('own-account',false,{page:2,limit:12,term:'Monster',status:'complete',brazilianPublisherId:4});
});
it('valida e encaminha os filtros da lista de desejos',async()=>{
    req.query={page:'2',term:'  Monster  ',brazilianPublisherId:'4'};
    await handlers.getWishlist(req,res,next);
    expect(readers.listWishlist).toHaveBeenCalledWith('own-account',false,{page:2,limit:12,term:'Monster',brazilianPublisherId:4});
});
it.each([
    ['putOwned','params',{volumeId:'invalid'}],['getSelection','params',{editionId:'0'}],['getCollection','query',{limit:'51'}],
    ['getCollection','query',{status:'unknown'}],['getCollection','query',{brazilianPublisherId:'0'}],
    ['getWishlist','query',{term:' '}],['getWishlist','query',{brazilianPublisherId:'0'}],
    ['patchRead','body',{read:'yes'}],['putEdition','body',{addVolumeIds:[3],removeVolumeIds:[3]}]
])('%s recusa entrada inválida sem operação parcial',async(name,field,value)=>{
    req[field]=value;await handlers[name](req,res,next);expect(next).toHaveBeenCalledWith(expect.objectContaining({statusCode:400,code:'INVALID_PERSONAL_INPUT'}));
});
it('erro persistência chega ao tratamento central e não envia sucesso',async()=>{
    const failure=new Error('database unavailable');mutations.addOwned.mockRejectedValue(failure);
    await handlers.putOwned(req,res,next);expect(next).toHaveBeenCalledWith(failure);expect(res.json).not.toHaveBeenCalled();
});
