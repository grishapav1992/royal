import type {PostgresDatabase} from './database';
import {applySchemaMigration} from './database-migrations';
import {CREW_IDS,CREW_UNLOCK_COST,crewDay,isCrewId,type CrewCollection,type CrewRequest} from '../src/shared/caribbeanCrew';
export class CrewCollectionError extends Error{constructor(public status:number,public code:string){super(code);}}
const fail=(status:number,code:string):never=>{throw new CrewCollectionError(status,code);};
/** The first collection stays readable for packages that are still open. Its tokens and pirates moved to the voyage (server/caribbeanVoyage.ts). */
export class CaribbeanCrewStore{
 readonly ready:Promise<void>;
 constructor(private db:PostgresDatabase,prerequisite:Promise<void>=Promise.resolve(),private now=Date.now){
  this.ready=prerequisite.then(()=>applySchemaMigration(db,{id:'caribbean-crew-collection-v1',statements:[
   `CREATE TABLE IF NOT EXISTS caribbean_crew_profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,selected_id TEXT NOT NULL DEFAULT 'isabella',revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0))`,
   `CREATE TABLE IF NOT EXISTS caribbean_crew_owned(account_id TEXT NOT NULL REFERENCES caribbean_crew_profiles(account_id) ON DELETE CASCADE,character_id TEXT NOT NULL,cost BIGINT NOT NULL CHECK(cost IN (0,100)),unlocked_at BIGINT NOT NULL,PRIMARY KEY(account_id,character_id))`,
   `CREATE TABLE IF NOT EXISTS caribbean_crew_completed(account_id TEXT NOT NULL REFERENCES caribbean_crew_profiles(account_id) ON DELETE CASCADE,challenge_key TEXT NOT NULL,reward BIGINT NOT NULL CHECK(reward IN (20,50)),completed_at BIGINT NOT NULL,PRIMARY KEY(account_id,challenge_key))`,
   `CREATE TABLE IF NOT EXISTS caribbean_crew_requests(account_id TEXT NOT NULL REFERENCES caribbean_crew_profiles(account_id) ON DELETE CASCADE,request_id TEXT NOT NULL,request_key TEXT NOT NULL,PRIMARY KEY(account_id,request_id))`,
  ]}));
 }
 private async ensure(account:string){
  await this.db.prepare('INSERT INTO caribbean_crew_profiles(account_id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
  await this.db.prepare("INSERT INTO caribbean_crew_owned(account_id,character_id,cost,unlocked_at) VALUES(?,'isabella',0,?) ON CONFLICT DO NOTHING").run(account,this.now());
 }
 private async view(account:string):Promise<CrewCollection>{
  const profile=(await this.db.prepare('SELECT selected_id,revision FROM caribbean_crew_profiles WHERE account_id=?').get(account))!;
  const owned=await this.db.prepare('SELECT character_id,cost FROM caribbean_crew_owned WHERE account_id=?').all(account);
  const completed=await this.db.prepare('SELECT reward FROM caribbean_crew_completed WHERE account_id=?').all(account);
  const day=crewDay(this.now());
  return{version:1,accountId:account,revision:profile.revision,day,nextResetAt:Date.parse(day+'T00:00:00+03:00')+86400000,tokens:completed.reduce((n,row)=>n+row.reward,0)-owned.reduce((n,row)=>n+row.cost,0),unlockCost:CREW_UNLOCK_COST,owned:CREW_IDS.filter(id=>owned.some(row=>row.character_id===id)),selected:profile.selected_id,challenges:[]};
 }
 async snapshot(account:string){await this.ready;return this.db.transaction(async()=>{await this.ensure(account);return this.view(account);},{lockKey:'crew:'+account});}
 async operate(account:string,value:unknown){
  await this.ready;
  if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid-request');
  const request=value as CrewRequest,keys=Object.keys(request).sort().join(',');
  if(typeof request.id!=='string'||!/^[a-f0-9-]{36}$/i.test(request.id))fail(400,'invalid-request');
  if(request.action==='answer'){
   if(keys!=='action,answer,challengeId,day,id'||typeof request.challengeId!=='string'||typeof request.answer!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(request.day))fail(400,'invalid-request');
  }else if(!['unlock','select'].includes(request.action)||keys!=='action,characterId,id'||!isCrewId(request.characterId))fail(400,'invalid-request');
  const requestKey=JSON.stringify(Object.entries(request).filter(([key])=>key!=='id').sort(([a],[b])=>a.localeCompare(b)));
  return this.db.transaction(async()=>{
   await this.ensure(account);
   const previous=await this.db.prepare('SELECT request_key FROM caribbean_crew_requests WHERE account_id=? AND request_id=?').get(account,request.id);
   if(previous){if(previous.request_key!==requestKey)fail(409,'request-conflict');return this.view(account);}
   if(request.action!=='select')throw new CrewCollectionError(410,'collection-moved');
   const state=await this.view(account);let changed=false;
   if(!state.owned.includes(request.characterId as typeof state.selected))fail(403,'captain-locked');
   if(state.selected!==request.characterId){await this.db.prepare('UPDATE caribbean_crew_profiles SET selected_id=? WHERE account_id=?').run(request.characterId,account);changed=true;}
   if(changed)await this.db.prepare('UPDATE caribbean_crew_profiles SET revision=revision+1 WHERE account_id=?').run(account);
   await this.db.prepare('INSERT INTO caribbean_crew_requests(account_id,request_id,request_key) VALUES(?,?,?)').run(account,request.id,requestKey);
   return{...await this.view(account),receipt:{requestId:request.id,reward:0}};
  },{lockKey:'crew:'+account});
 }
}
