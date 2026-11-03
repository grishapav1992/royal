import type {PostgresDatabase} from './database';
import {applySchemaMigration} from './database-migrations';
import {STAR_CHARACTERS,starCharacter,starDay,isStarSide,type StarChallenge,type StarCollection,type StarRequest,type StarText} from '../src/shared/starSpinCollection';
export class StarCollectionError extends Error{constructor(public status:number,public code:string){super(code);}}
const fail=(status:number,code:string):never=>{throw new StarCollectionError(status,code);};
const text=(ru:string,en:string):StarText=>({ru,en});
type Question=Omit<StarChallenge,'completed'>&{correct:string};
const options=(...values:[string,string][])=>values.map(([ru,en],i)=>({id:String(i),text:text(ru,en)}));
function questions(day:string):Question[]{return[
 {id:'lesson-side',kind:'lesson',reward:50,title:text('Выбор пути','Choose your path'),question:text('Что меняется при выборе стороны?','What changes when you choose a side?'),options:options(['Героиня и оформление','Your companion and presentation'],['Вероятности выигрыша','Winning probabilities'],['Баланс кошелька','Wallet balance']),correct:'0'},
 {id:'lesson-wild',kind:'lesson',reward:50,title:text('Сила реликвии','Power of the relic'),question:text('Что делает доводка неполного WILD?','What does a partial WILD nudge do?'),options:options(['Списывает новую ставку','Debits another stake'],['Совмещает секции и повышает множитель','Aligns the chambers and raises its multiplier'],['Открывает героиню за USDT','Unlocks a companion for USDT']),correct:'1'},
 {id:'lesson-bonus',kind:'lesson',reward:50,title:text('Звёздный портал','Star portal'),question:text('Сколько бесплатных спинов дают 3 или больше SCATTER?','How many free spins do 3 or more SCATTER reels award?'),options:options(['5','5'],['10','10'],['8','8']),correct:'2'},
 {id:'daily-archive',kind:'daily',reward:50,title:text('Архив дня','Daily archive'),question:Math.floor(Date.parse(day+'T00:00:00Z')/86400000)%2===0?text('Как получить жетоны коллекции?','How do you earn collection tokens?'):text('Можно ли менять сторону и сохранять открытых героинь?','Can you switch sides and keep your unlocked companions?'),options:Math.floor(Date.parse(day+'T00:00:00Z')/86400000)%2===0?options(['За бесплатные задания','Through free challenges'],['За проигрыш','By losing a wager'],['Купить за USDT','Buy with USDT']):options(['Да, коллекция сохраняется','Yes, your collection is kept'],['Нет, всё обнуляется','No, everything resets'],['Только после покупки','Only after a purchase']),correct:'0'},
];}
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
  await this.db.prepare('INSERT INTO star_spin_profiles(account_id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
  for(const c of STAR_CHARACTERS.filter(c=>c.cost===0))await this.db.prepare('INSERT INTO star_spin_owned(account_id,character_id,cost,unlocked_at) VALUES(?,?,0,?) ON CONFLICT DO NOTHING').run(account,c.id,this.now());
 }
 private async view(account:string):Promise<StarCollection>{
  const p=(await this.db.prepare('SELECT side,light_id,dark_id,revision FROM star_spin_profiles WHERE account_id=?').get(account))!;
  const owned=await this.db.prepare('SELECT character_id,cost FROM star_spin_owned WHERE account_id=?').all(account),completed=await this.db.prepare('SELECT challenge_key,reward FROM star_spin_completed WHERE account_id=?').all(account);
  const day=starDay(this.now()),done=new Set(completed.map(r=>r.challenge_key));
  return{version:1,accountId:account,revision:p.revision,day,nextResetAt:Date.parse(day+'T00:00:00+03:00')+86400000,tokens:completed.reduce((n,r)=>n+r.reward,0)-owned.reduce((n,r)=>n+r.cost,0),side:p.side,selected:p.side==='light'?p.light_id:p.side==='dark'?p.dark_id:null,selectedBySide:{light:p.light_id,dark:p.dark_id},owned:STAR_CHARACTERS.filter(c=>owned.some(r=>r.character_id===c.id)).map(c=>c.id),challenges:questions(day).map(({correct,...q})=>({...q,completed:done.has(q.kind==='daily'?day+':'+q.id:q.id)}))};
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
   const state=await this.view(account);let changed=false,reward=0,unlocked:StarCollection['selected']=null;
   if(r.action==='answer'){
    const q=questions(state.day).find(q=>q.id===r.challengeId);if(!q)fail(400,'invalid-challenge');
    if(q!.kind==='daily'&&r.day!==state.day)fail(409,'day-changed');if(r.answer!==q!.correct)fail(422,'incorrect-answer');
    changed=!!(await this.db.prepare('INSERT INTO star_spin_completed(account_id,challenge_key,reward,completed_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(account,q!.kind==='daily'?state.day+':'+q!.id:q!.id,q!.reward,this.now())).changes;if(changed)reward=q!.reward;
   }else if(r.action==='side'){
    if(r.side!==state.side){await this.db.prepare('UPDATE star_spin_profiles SET side=? WHERE account_id=?').run(r.side,account);changed=true;}
   }else{
    const c=starCharacter(r.characterId)!;
    if(r.action==='unlock'){
     if(!state.owned.includes(c.id)){if(state.tokens<c.cost)fail(409,'not-enough-tokens');await this.db.prepare('INSERT INTO star_spin_owned(account_id,character_id,cost,unlocked_at) VALUES(?,?,?,?)').run(account,c.id,c.cost,this.now());changed=true;unlocked=c.id;}
    }else{
     if(!state.owned.includes(c.id))fail(403,'character-locked');
     if(state.selectedBySide[c.side]!==c.id||state.side!==c.side){await this.db.prepare(c.side==='light'?'UPDATE star_spin_profiles SET side=?,light_id=? WHERE account_id=?':'UPDATE star_spin_profiles SET side=?,dark_id=? WHERE account_id=?').run(c.side,c.id,account);changed=true;}
    }
   }
   if(changed)await this.db.prepare('UPDATE star_spin_profiles SET revision=revision+1 WHERE account_id=?').run(account);
   await this.db.prepare('INSERT INTO star_spin_requests(account_id,request_id,request_key) VALUES(?,?,?)').run(account,r.id,key);
   return{...await this.view(account),receipt:{requestId:r.id,reward,...(unlocked?{unlocked}: {})}};
  },{lockKey:'star-spin:'+account});
 }
}
