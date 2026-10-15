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
function sync(body){return request(app).put(`${base}/collection/editions/${f.editionId}`).set('Cookie',f.owner.cookie).send(body);}
async function rows(user=f.owner){return (await db.query('SELECT volume_id,state,read FROM user_volumes WHERE user_id=$1 ORDER BY volume_id',[user.id])).rows;}

beforeEach(async()=>{f=await fixture();});
afterEach(async()=>{if(f)await f.cleanup();});

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
it('ausência no delta não remove vínculo privado oculto',async()=>{
    await own();await read();await db.query("UPDATE volumes SET visibility='Privado' WHERE id=$1",[f.first]);
    expect((await sync({addVolumeIds:[f.second],removeVolumeIds:[]})).status).toBe(200);
    expect((await rows()).find(r=>r.volume_id===f.first).read).toBe(true);
    expect((await sync({addVolumeIds:[],removeVolumeIds:[f.first]})).status).toBe(404);
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
it('exige sessão válida em todas mutações pessoais',async()=>{
    const paths=[['put',`collection/volumes/${f.first}`],['patch',`collection/volumes/${f.first}`],['delete',`collection/volumes/${f.first}`],['put',`wishlist/volumes/${f.first}`],['delete',`wishlist/volumes/${f.first}`],['put',`collection/editions/${f.editionId}`]];
    for(const [method,path]of paths)expect((await request(app)[method](`${base}/${path}`)).status).toBe(401);
    const expired=await f.user();await db.query('UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1',[expired.id]);
    expect((await own(f.first,expired)).status).toBe(401);
});
it.each(['volumes','editions','works'])('privacidade em %s impede escrita sem apagar acervo',async table=>{
    await own();await read();
    const id={volumes:f.first,editions:f.editionId,works:f.workId}[table];
    await db.query(`UPDATE ${table} SET visibility='Privado' WHERE id=$1`,[id]);
    expect((await own()).status).toBe(404);expect((await wish()).status).toBe(404);expect((await read()).status).toBe(404);
    expect((await rows())[0].read).toBe(true);
    await db.query(`UPDATE ${table} SET visibility='Público' WHERE id=$1`,[id]);
    expect((await own()).body.read).toBe(true);
});
it('conteúdo adulto exige idade e preferência vigentes',async()=>{
    await db.query('UPDATE works SET adult_content=true WHERE id=$1',[f.workId]);
    expect((await own()).status).toBe(404);
    await db.query('UPDATE users SET conteudo_adulto=true WHERE id=$1',[f.owner.id]);
    expect((await own()).status).toBe(200);
    await db.query("UPDATE users SET birth_date='2015-01-01' WHERE id=$1",[f.owner.id]);
    expect((await wish(f.second)).status).toBe(404);
});
it('rejeita corpo, identificadores e deltas inválidos sem alterar vínculos',async()=>{
    expect((await sync({addVolumeIds:[f.first],removeVolumeIds:[f.first]})).status).toBe(400);
    expect((await own('1.5')).status).toBe(400);
    expect((await request(app).patch(`${base}/collection/volumes/${f.first}`).set('Cookie',f.owner.cookie).send({read:'true'})).status).toBe(400);
    expect(await rows()).toEqual([]);
});
