import type {PostgresDatabase} from './database';
import {applySchemaMigration} from './database-migrations';
import {STAR_CHARACTERS,starCharacter,starDay,isStarSide,type StarCollection,type StarRequest} from '../src/shared/starSpinCollection';
export class StarCollectionError extends Error{constructor(public status:number,public code:string){super(code);}}
const fail=(status:number,code:string):never=>{throw new StarCollectionError(status,code);};
export class StarSpinCollectionStore{
 readonly ready:Promise<void>;
 constructor(private db:PostgresDatabase,prerequisite:Promise<void>=Promise.resolve(),private now=Date.now){
  this.ready=prerequisite.then(()=>applySchemaMigration(db,{id:'star-spin-cosmetic-collection-v1',statements:[
   `CREATE TABLE IF NOT EXISTS star_spin_profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,side TEXT CHECK(side IN ('light','dark')),light_id TEXT NOT NULL DEFAULT 'lyra',dark_id TEXT NOT NULL DEFAULT 'vespera',revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0))`,
   `CREATE TABLE IF NOT EXISTS star_spin_owned(account_id TEXT NOT NULL REFERENCES star_spin_profiles(account_id) ON DELETE CASCADE,character_id TEXT NOT NULL,cost BIGINT NOT NULL CHECK(cost>=0),unlocked_at BIGINT NOT NULL,PRIMARY KEY(account_id,character_id))`,
   `CREATE TABLE IF NOT EXISTS star_spin_completed(account_id TEXT NOT NULL REFERENCES star_spin_profiles(account_id) ON DELETE CASCADE,challenge_key TEXT NOT NULL,reward BIGINT NOT NULL CHECK(reward>0),completed_at BIGINT NOT NULL,PRIMARY KEY(account_id,challenge_key))`,
   `CREATE TABLE IF NOT EXISTS star_spin_requests(account_id TEXT NOT NULL REFERENCES star_spin_profiles(account_id) ON DELETE CASCADE,request_id TEXT NOT NULL,request_key TEXT NOT NULL,PRIMARY KEY(account_id,request_id))`,
  ]}));
 }
 private async ensure(account:string){
  const created=!!(await this.db.prepare('INSERT INTO star_spin_profiles(account_id) VALUES(?) ON CONFLICT DO NOTHING').run(account)).changes;
  // Existing costs and completions remain historical records; new grants cost zero.
  let granted=0;
  for(const c of STAR_CHARACTERS)granted+=(await this.db.prepare('INSERT INTO star_spin_owned(account_id,character_id,cost,unlocked_at) VALUES(?,?,0,?) ON CONFLICT DO NOTHING').run(account,c.id,this.now())).changes;
  if(!created&&granted)await this.db.prepare('UPDATE star_spin_profiles SET revision=revision+1 WHERE account_id=?').run(account);
 }
 private async view(account:string):Promise<StarCollection>{
  const p=(await this.db.prepare('SELECT side,light_id,dark_id,revision FROM star_spin_profiles WHERE account_id=?').get(account))!;
  const owned=await this.db.prepare('SELECT character_id,cost FROM star_spin_owned WHERE account_id=?').all(account),completed=await this.db.prepare('SELECT challenge_key,reward FROM star_spin_completed WHERE account_id=?').all(account);
  const day=starDay(this.now());
  return{version:1,accountId:account,revision:p.revision,day,nextResetAt:Date.parse(day+'T00:00:00+03:00')+86400000,tokens:completed.reduce((n,r)=>n+r.reward,0)-owned.reduce((n,r)=>n+r.cost,0),side:p.side,selected:p.side==='light'?p.light_id:p.side==='dark'?p.dark_id:null,selectedBySide:{light:p.light_id,dark:p.dark_id},owned:STAR_CHARACTERS.filter(c=>owned.some(r=>r.character_id===c.id)).map(c=>c.id),challenges:[]};
 }
 async snapshot(account:string){await this.ready;return this.db.transaction(async()=>{await this.ensure(account);return this.view(account);},{lockKey:'star-spin:'+account});}
 async operate(account:string,value:unknown){
  await this.ready;if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid-request');
  const r=value as StarRequest,keys=Object.keys(r).sort().join(',');
  if(typeof r.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.id))fail(400,'invalid-request');
  if(r.action==='side'){if(keys!=='action,id,side'||!isStarSide(r.side))fail(400,'invalid-request');}
  else if(r.action==='answer'){if(keys!=='action,answer,challengeId,day,id'||typeof r.challengeId!=='string'||typeof r.answer!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.day))fail(400,'invalid-request');}
  else if(!['unlock','select'].includes(r.action)||keys!=='action,characterId,id'||!starCharacter(r.characterId))fail(400,'invalid-request');
  const key=JSON.stringify(Object.entries(r).filter(([k])=>k!=='id').sort(([a],[b])=>a.localeCompare(b)));
  return this.db.transaction(async()=>{
   await this.ensure(account);const previous=await this.db.prepare('SELECT request_key FROM star_spin_requests WHERE account_id=? AND request_id=?').get(account,r.id);
   if(previous){if(previous.request_key!==key)fail(409,'request-conflict');return this.view(account);}
   const state=await this.view(account);let changed=false;
   if(r.action==='answer'){
    fail(410,'collection-paused');
   }else if(r.action==='side'){
    if(r.side!==state.side){await this.db.prepare('UPDATE star_spin_profiles SET side=? WHERE account_id=?').run(r.side,account);changed=true;}
   }else if(r.action==='select'){
    const c=starCharacter(r.characterId)!;
    if(!state.owned.includes(c.id))fail(403,'character-locked');
    if(state.selectedBySide[c.side]!==c.id||state.side!==c.side){await this.db.prepare(c.side==='light'?'UPDATE star_spin_profiles SET side=?,light_id=? WHERE account_id=?':'UPDATE star_spin_profiles SET side=?,dark_id=? WHERE account_id=?').run(c.side,c.id,account);changed=true;}
   }
   if(changed)await this.db.prepare('UPDATE star_spin_profiles SET revision=revision+1 WHERE account_id=?').run(account);
   await this.db.prepare('INSERT INTO star_spin_requests(account_id,request_id,request_key) VALUES(?,?,?)').run(account,r.id,key);
   return{...await this.view(account),receipt:{requestId:r.id,reward:0}};
  },{lockKey:'star-spin:'+account});
 }
}
