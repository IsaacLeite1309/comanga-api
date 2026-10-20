const crypto = require('node:crypto');
const db = require('../../src/database');
const { createTestCover } = require('./cover');
const { hashSessionToken } = require('../../src/modules/auth/session');

async function fixture() {
    const prefix = `personal_${crypto.randomUUID()}`;
    const type = await db.query("SELECT v.id FROM domain_option_values v JOIN domain_option_categories c ON c.id=v.category_id WHERE c.slug='tipos-obra' LIMIT 1");
    const category = await db.query("INSERT INTO domain_option_categories(slug,name) VALUES ('editoras-brasileiras','Editoras Brasileiras') ON CONFLICT(slug) DO UPDATE SET name=domain_option_categories.name RETURNING id");
    const publisher = await db.query('INSERT INTO domain_option_values(category_id,label) VALUES($1,$2) RETURNING id',[category.rows[0].id,prefix]);
    const work = await db.query(`INSERT INTO works(slug,title,romanized_title,synopsis,type_id,country,original_publication_status,cover_asset_id,visibility) VALUES($1::text,$1::text,$1::text,$1::text,$2,'Japão','Completa',$3,'Público') RETURNING id`,[prefix,type.rows[0].id,await createTestCover(db,prefix)]);
    const edition = await db.query(`INSERT INTO editions(work_id,brazilian_publisher_id,chronological_number,brazil_publication_status,visibility) VALUES($1,$2,1,'Completa','Público') RETURNING id`,[work.rows[0].id,publisher.rows[0].id]);
    const volumeIds=[];
    async function volume(number, editionId=edition.rows[0].id) {
        const cover=await createTestCover(db,prefix);
        const result=await db.query(`INSERT INTO volumes(edition_id,number,cover_asset_id,release_date_precision,release_year,release_month,release_day,visibility) VALUES($1,$2,$3,'Completa',2026,10,15,'Público') RETURNING id`,[editionId,number,cover]);
        volumeIds.push(result.rows[0].id);
        return result.rows[0].id;
    }
    const users=[];
    async function user(adult=false) {
        const token=crypto.randomBytes(24).toString('hex');
        const id=crypto.randomUUID();
        await db.query(`INSERT INTO users(id,username,email,password_hash,status,birth_date,conteudo_adulto) VALUES($1,$2,$3,'hash','Ativada','1990-01-01',$4)`,[id,`personal_${id.slice(0,8)}`,`${id}@personal.test`,adult]);
        await db.query('INSERT INTO sessions(user_id,session_token_hash) VALUES($1,$2)',[id,hashSessionToken(token)]);
        users.push(id);
        return {id,cookie:`comanga_session=${token}`};
    }
    const first=await volume(1),second=await volume(2),third=await volume(3);
    const owner=await user(),other=await user();
    async function cleanup() {
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
        await db.query('DELETE FROM volumes WHERE id=ANY($1::int[])',[volumeIds]);
        await db.query('DELETE FROM editions WHERE work_id=$1',[work.rows[0].id]);
        await db.query('DELETE FROM works WHERE id=$1',[work.rows[0].id]);
        await db.query('DELETE FROM media_assets WHERE object_key LIKE $1',[`${prefix}/%`]);
        await db.query('DELETE FROM domain_option_values WHERE id=$1',[publisher.rows[0].id]);
    }
    return {prefix,workId:work.rows[0].id,editionId:edition.rows[0].id,first,second,third,owner,other,user,volume,cleanup};
}
module.exports={fixture};
