process.env.MEDIA_PUBLIC_BASE_URL='https://media.example.test';
const request=require('supertest');
const {setTimeout}=require('node:timers');
const app=require('../src/app');
const db=require('../src/database');
const {fixture}=require('./helpers/personalCatalog');
const base='/api/users/me';
let f;
function own(id=f.first,user=f.owner) {return request(app).put(`${base}/collection/volumes/${id}`).set('Cookie',user.cookie);}
function wish(id=f.first,user=f.owner) {return request(app).put(`${base}/wishlist/volumes/${id}`).set('Cookie',user.cookie);}
function read(id=f.first,value=true,user=f.owner) {return request(app).patch(`${base}/collection/volumes/${id}`).set('Cookie',user.cookie).send({read:value});}
function get(path,user=f.owner){return request(app).get(`${base}/${path}`).set('Cookie',user.cookie);}
function sync(body){return request(app).put(`${base}/collection/editions/${f.editionId}`).set('Cookie',f.owner.cookie).send(body);}
async function rows(user=f.owner){return (await db.query('SELECT volume_id,state,read FROM user_volumes WHERE user_id=$1 ORDER BY volume_id',[user.id])).rows;}

beforeEach(async()=>{f=await fixture();});
afterEach(async()=>{if(f)await f.cleanup();});

it('exige sessão em todas operações pessoais e rejeita sessão revogada',async()=>{
    const paths=[['get','collection'],['get','wishlist'],['get',`collection/editions/${f.editionId}`],['put',`collection/volumes/${f.first}`],['patch',`collection/volumes/${f.first}`],['delete',`collection/volumes/${f.first}`],['put',`wishlist/volumes/${f.first}`],['delete',`wishlist/volumes/${f.first}`],['put',`collection/editions/${f.editionId}`]];
    for(const [method,path]of paths)expect((await request(app)[method](`${base}/${path}`)).status).toBe(401);
    const expired=await f.user();
    await db.query('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1',[expired.id]);
    expect((await get('collection',expired)).status).toBe(401);
});
it('posse inicia não lida, converte desejo e repetição preserva leitura',async()=>{
    expect((await wish()).body).toEqual({volumeId:f.first,owned:false,wished:true});
    expect((await own()).body).toEqual({volumeId:f.first,owned:true,read:false,wished:false});
    expect((await read()).status).toBe(200);
    expect((await own()).body.read).toBe(true);
    expect((await wish()).status).toBe(409);
    expect((await rows())).toEqual([{volume_id:f.first,state:'Owned',read:true}]);
});
it('unicidade, estado e leitura são garantidos fisicamente',async()=>{
    await own();
    await expect(db.query("INSERT INTO user_volumes(user_id,volume_id,state,read) VALUES($1,$2,'Wanted',NULL)",[f.owner.id,f.first])).rejects.toMatchObject({code:'23505'});
    for(const [state,value]of [['Wanted',false],['Owned',null],['Invalid',null]]){
        await expect(db.query('INSERT INTO user_volumes(user_id,volume_id,state,read) VALUES($1,$2,$3,$4)',[f.owner.id,f.second,state,value])).rejects.toMatchObject({code:'23514'});
    }
});
it('remoção é idempotente, isolada e elimina leitura sem catálogo',async()=>{
    await own();await read();await own(f.first,f.other);
    expect((await request(app).delete(`${base}/collection/volumes/${f.first}`).set('Cookie',f.owner.cookie)).status).toBe(204);
    expect((await request(app).delete(`${base}/collection/volumes/${f.first}`).set('Cookie',f.owner.cookie)).status).toBe(204);
    expect((await read()).status).toBe(404);
    expect((await rows())).toEqual([]);expect((await rows(f.other))).toHaveLength(1);
    expect((await own()).body.read).toBe(false);
    expect((await db.query('SELECT id FROM volumes WHERE id=$1',[f.first])).rowCount).toBe(1);
});
it('desejo repetido é idempotente; remover desejo não remove posse',async()=>{
    await Promise.all([wish(),wish(),wish()]);expect(await rows()).toHaveLength(1);
    expect((await request(app).delete(`${base}/wishlist/volumes/${f.first}`).set('Cookie',f.owner.cookie)).status).toBe(204);
    await own();
    await request(app).delete(`${base}/wishlist/volumes/${f.first}`).set('Cookie',f.owner.cookie);
    expect((await rows())[0].state).toBe('Owned');
});
it('sincroniza lote, remove desejos e preserva leitura já existente',async()=>{
    await own();await read();await wish(f.second);await own(f.third);
    const response=await sync({addVolumeIds:[f.first,f.second],removeVolumeIds:[f.third]});
    expect(response.status).toBe(200);
    expect(await rows()).toEqual([{volume_id:f.first,state:'Owned',read:true},{volume_id:f.second,state:'Owned',read:false}]);
});
it('falha validação do lote preserva acervo e não aceita edição alheia',async()=>{
    await own();await read();await wish(f.second);
    const prior=await rows();
    expect((await sync({addVolumeIds:[f.second,2147483647],removeVolumeIds:[f.first]})).status).toBe(404);
    expect(await rows()).toEqual(prior);
    const another=await db.query("INSERT INTO editions(work_id,brazilian_publisher_id,chronological_number,brazil_publication_status,visibility) SELECT work_id,brazilian_publisher_id,2,brazil_publication_status,visibility FROM editions WHERE id=$1 RETURNING id",[f.editionId]);
    const foreign=await f.volume(1,another.rows[0].id);
    expect((await sync({addVolumeIds:[foreign],removeVolumeIds:[f.first]})).status).toBe(404);
    expect(await rows()).toEqual(prior);
});
it('erro real depois da primeira gravação reverte inclusões e remoções',async()=>{
    await own(f.third);await wish(f.first);const prior=await rows();
    await db.query(`CREATE FUNCTION personal_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.volume_id=${f.second} THEN RAISE EXCEPTION 'forced rollback'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER personal_test_failure BEFORE INSERT OR UPDATE ON user_volumes FOR EACH ROW EXECUTE FUNCTION personal_test_failure()');
    try{
        expect((await sync({addVolumeIds:[f.first,f.second],removeVolumeIds:[f.third]})).status).toBe(500);
        expect(await rows()).toEqual(prior);
    }finally{await db.query('DROP TRIGGER personal_test_failure ON user_volumes');await db.query('DROP FUNCTION personal_test_failure()');}
});
it('requisições concorrentes preservam posse única e exclusão mútua',async()=>{
    const responses=await Promise.all([own(),wish(),own(),wish(),own()]);
    expect(responses.every(r=>[200,409].includes(r.status))).toBe(true);
    expect(await rows()).toEqual([{volume_id:f.first,state:'Owned',read:false}]);
    const batches=await Promise.all([sync({addVolumeIds:[f.second],removeVolumeIds:[f.first]}),sync({addVolumeIds:[f.first],removeVolumeIds:[f.second]})]);
    expect(batches.map(r=>r.status)).toEqual([200,200]);expect(await rows()).toHaveLength(1);
});
it.each(['volume','edition','work'])('privacidade de %s omite sem apagar e impede novas inclusões',async(level)=>{
    await own();await read();await wish(f.second);
    const target={volume:['volumes',f.first],edition:['editions',f.editionId],work:['works',f.workId]}[level];
    await db.query(`UPDATE ${target[0]} SET visibility='Privado' WHERE id=$1`,[target[1]]);
    expect((await get('collection')).body.works).toEqual([]);
    expect((await own()).status).toBe(404);expect((await read()).status).toBe(404);
    if(level!=='volume')expect((await get('wishlist')).body.volumes).toEqual([]);
    expect((await rows()).find(r=>r.volume_id===f.first).read).toBe(true);
    await db.query(`UPDATE ${target[0]} SET visibility='Público' WHERE id=$1`,[target[1]]);
    expect((await get('collection')).body.works[0].editions[0].volumes[0].read).toBe(true);
});
it('ausência no delta não remove vínculo privado oculto',async()=>{
    await own();await read();await db.query("UPDATE volumes SET visibility='Privado' WHERE id=$1",[f.first]);
    expect((await sync({addVolumeIds:[f.second],removeVolumeIds:[]})).status).toBe(200);
    expect((await rows()).find(r=>r.volume_id===f.first).read).toBe(true);
    expect((await sync({addVolumeIds:[],removeVolumeIds:[f.first]})).status).toBe(404);
});
it('política adulta aplica flag, preferência e nascimento',async()=>{
    await own();await db.query('UPDATE works SET adult_content=true WHERE id=$1',[f.workId]);
    expect((await get('collection')).body.works).toEqual([]);expect((await own()).status).toBe(404);
    await db.query('UPDATE users SET conteudo_adulto=true WHERE id=$1',[f.owner.id]);
    expect((await get('collection')).body.works).toHaveLength(1);
    await db.query("UPDATE users SET birth_date='2015-01-01' WHERE id=$1",[f.owner.id]);
    expect((await get('collection')).body.works).toEqual([]);
    await db.query("UPDATE users SET birth_date='1990-01-01',conteudo_adulto=false WHERE id=$1",[f.owner.id]);
});
it('consultas vazias e agrupamento mostram progresso público e isolamento',async()=>{
    expect((await get('collection')).body).toEqual({works:[],pagination:{page:1,limit:12,total:0,totalPages:0}});
    expect((await get('wishlist')).body.volumes).toEqual([]);
    await own();await read();await own(f.second,f.other);await wish(f.third);
    const response=await get('collection');
    expect(response.headers['cache-control']).toBe('private, no-store');expect(response.headers.vary).toContain('Cookie');
    expect(response.body.works[0].editions[0].progress).toEqual({owned:1,total:3,read:1,wished:1});
    expect(response.body.works[0].editions[0].volumes).toHaveLength(1);
    expect((await get('wishlist')).body.volumes.map(v=>v.id)).toEqual([f.third]);
    const selection=(await get(`collection/editions/${f.editionId}`)).body;
    expect(selection.volumes.find(v=>v.id===f.second)).toMatchObject({owned:false,read:null,wished:false});
    expect(selection.volumes.find(v=>v.id===f.third)).toMatchObject({owned:false,read:null,wished:true});
});
it('seleção funciona sem posse e paginação permite mais de50 volumes',async()=>{
    for(let n=4;n<=53;n++)await f.volume(n);
    const first=await get(`collection/editions/${f.editionId}?limit=50`);
    const second=await get(`collection/editions/${f.editionId}?limit=50&page=2`);
    expect(first.body.volumes).toHaveLength(50);expect(second.body.volumes).toHaveLength(3);
    expect(second.body.pagination).toEqual({page:2,limit:50,total:53,totalPages:2});
    await sync({addVolumeIds:[...first.body.volumes,...second.body.volumes].map(v=>v.id),removeVolumeIds:[]});
    const collection=(await get('collection')).body;
    expect(collection.works[0].editions[0].volumes).toHaveLength(50);
    expect(collection.works[0].editions[0].volumesPagination.totalPages).toBe(2);
});
it('rejeita ids, booleanos, corpo e limites inválidos sem escrita',async()=>{
    for(const body of [{addVolumeIds:[f.first,f.first],removeVolumeIds:[]},{addVolumeIds:[f.first],removeVolumeIds:[f.first]},{addVolumeIds:Array.from({length:101},(_,i)=>i+1),removeVolumeIds:[]},{addVolumeIds:[f.first],removeVolumeIds:[],userId:f.other.id}])expect((await sync(body)).status).toBe(400);
    for(const query of ['limit=51','page=0','page=2147483647&limit=50','userId=someone'])expect((await get(`collection?${query}`)).status).toBe(400);
    expect((await request(app).patch(`${base}/collection/volumes/${f.first}`).set('Cookie',f.owner.cookie).send({read:'true'})).status).toBe(400);
    expect((await own('1.5')).status).toBe(400);expect(await rows()).toEqual([]);
});
it('exclusão de conta e Volume elimina vínculos em cascata',async()=>{
    const user=await f.user();await own(f.first,user);
    await db.query('DELETE FROM users WHERE id=$1',[user.id]);expect(await rows(user)).toEqual([]);
    const volume=await f.volume(54);await own(volume);await wish(volume,f.other);
    await db.query('DELETE FROM volumes WHERE id=$1',[volume]);
    expect((await rows()).some(r=>r.volume_id===volume)).toBe(false);expect((await rows(f.other)).some(r=>r.volume_id===volume)).toBe(false);
});
it('bloqueio compartilhado espera catálogo e revalida visibilidade após commit',async()=>{
    const writer=await db.pool.connect();let pending;
    try{
        await writer.query('BEGIN');
        await writer.query("UPDATE works SET visibility='Privado' WHERE id=$1",[f.workId]);
        pending=own().then(result=>result);
        let waiting=false;
        for(let n=0;n<100&&!waiting;n++){
            const locks=await db.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=9142026 AND mode='ShareLock' AND NOT granted");
            waiting=locks.rowCount>0;
            if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
        }
        expect(waiting).toBe(true);
        await writer.query('COMMIT');
        expect((await pending).status).toBe(404);expect(await rows()).toEqual([]);
    }finally{
        await writer.query('ROLLBACK');writer.release();if(pending)await pending;
    }
});
it('gênero Hentai legado também restringe sem flag; atribuição admin vigente dispensa preferência',async()=>{
    await own();
    const genre=await db.query("SELECT v.id FROM domain_option_values v JOIN domain_option_categories c ON c.id=v.category_id WHERE c.slug='generos' AND v.code='hentai'");
    await db.query('INSERT INTO work_genres(work_id,genre_id) VALUES($1,$2)',[f.workId,genre.rows[0].id]);
    expect((await get('collection')).body.works).toEqual([]);expect((await wish(f.second)).status).toBe(404);
    const admin=await db.query("SELECT id FROM profiles WHERE code='ADMINISTRADOR'");
    await db.query('INSERT INTO user_profiles(user_id,profile_id) VALUES($1,$2)',[f.owner.id,admin.rows[0].id]);
    expect((await get('collection')).body.works).toHaveLength(1);expect((await wish(f.second)).status).toBe(200);
    await db.query('DELETE FROM user_profiles WHERE user_id=$1 AND profile_id=$2',[f.owner.id,admin.rows[0].id]);
    expect((await get('collection')).body.works).toEqual([]);
});
it('edições são paginação estável dos grupos, sem perder obra compartilhada',async()=>{
    const edition=await db.query("INSERT INTO editions(work_id,brazilian_publisher_id,chronological_number,brazil_publication_status,visibility) SELECT work_id,brazilian_publisher_id,2,brazil_publication_status,visibility FROM editions WHERE id=$1 RETURNING id",[f.editionId]);
    await own();const volume=await f.volume(1,edition.rows[0].id);await own(volume);
    const response=(await get('collection')).body;
    expect(response.works).toHaveLength(1);expect(response.works[0].editions).toHaveLength(2);expect(response.pagination.total).toBe(2);
    const second=(await get('collection?limit=1&page=2')).body;
    expect(second.works[0].editions[0].edition.id).toBe(edition.rows[0].id);expect(second.pagination.totalPages).toBe(2);
});
async function waitForLock(sql,params=[]){
    for(let n=0;n<100;n++){
        const result=await db.query(sql,params);if(result.rowCount)return;
        await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('Bloqueio concorrente esperado não observado.');
}
it('exclusão da conta aguarda posse pendente sem deadlock e remove vínculo em cascata',async()=>{
    const catalog=await db.pool.connect(),account=await db.pool.connect();let pending,deletion;
    try{
        await catalog.query('BEGIN');await catalog.query('SELECT pg_advisory_xact_lock(9142026)');
        pending=own().then(result=>result);
        await waitForLock("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=9142026 AND mode='ShareLock' AND NOT granted");
        const pid=(await account.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        deletion=account.query('DELETE FROM users WHERE id=$1',[f.owner.id]);
        await waitForLock("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[pid]);
        await catalog.query('COMMIT');
        expect((await pending).status).toBe(200);await deletion;expect(await rows()).toEqual([]);
    }finally{
        await catalog.query('ROLLBACK');catalog.release();if(pending)await pending;if(deletion)await deletion;account.release();
    }
});
it('exclusão iniciada primeiro invalida posse pendente sem criar órfão',async()=>{
    const account=await db.pool.connect();let pending;
    try{
        await account.query('BEGIN');await account.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[f.owner.id]);
        pending=own().then(result=>result);
        await waitForLock("SELECT 1 FROM pg_stat_activity WHERE query LIKE '%FROM users WHERE id = %FOR KEY SHARE%' AND wait_event_type='Lock'");
        await account.query('DELETE FROM users WHERE id=$1',[f.owner.id]);await account.query('COMMIT');
        expect((await pending).status).toBe(404);expect(await rows()).toEqual([]);
    }finally{await account.query('ROLLBACK');account.release();if(pending)await pending;}
});
