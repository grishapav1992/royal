import type {PostgresDatabase} from './database';
import {applySchemaMigration} from './database-migrations';
import {CREW_IDS,CREW_UNLOCK_COST,crewDay,isCrewId,type CrewChallenge,type CrewCollection,type CrewRequest,type CrewText} from '../src/shared/caribbeanCrew';
export class CrewCollectionError extends Error{constructor(public status:number,public code:string){super(code);}}
const fail=(status:number,code:string):never=>{throw new CrewCollectionError(status,code);};
const text=(ru:string,en:string):CrewText=>({ru,en});
type Question=Omit<CrewChallenge,'completed'>&{correct:string};
const choice=(...values:[string,string][])=>values.map(([ru,en],i)=>({id:String(i),text:text(ru,en)}));
const lessons:Question[]=[
 {id:'lesson-lines',kind:'lesson',reward:20,title:text('Знакомство с линиями','Meet the lines'),question:text('Какой набор линий доступен в игре?','Which line preset is available?'),options:choice(['1, 5, 10 или 20','1, 5, 10 or 20'],['Только 25','Only 25'],['Любое число от 1 до 100','Any number from 1 to 100']),correct:'0'},
 {id:'lesson-giant',kind:'lesson',reward:20,title:text('Гигант на палубе','A giant on deck'),question:text('Сколько клеток занимает гигант 2×2?','How many cells does a 2×2 giant occupy?'),options:choice(['Две','Two'],['Четыре','Four'],['Шесть','Six']),correct:'1'},
 {id:'lesson-cannon',kind:'lesson',reward:20,title:text('Пушечный залп','Cannon fire'),question:text('До какого размера залп может увеличить блок 2×2?','How large can cannon fire grow a 2×2 block?'),options:choice(['3×3','3×3'],['6×4','6×4'],['1×1','1×1']),correct:'0'},
 {id:'lesson-settlement',kind:'lesson',reward:20,title:text('Итог путешествия','Journey total'),question:text('Когда начисляется выплата всей бесплатной серии?','When is the whole free-spin series credited?'),options:choice(['При открытии окна','When opening the window'],['Перед выбором тактики','Before choosing a tactic'],['После завершения серии','After the series ends']),correct:'2'},
 {id:'lesson-cost',kind:'lesson',reward:20,title:text('Учебная ставка','Practice calculation'),question:text('Учебная задача: 5 линий по 2 USDT. Какова общая стоимость? Ставка не совершается.','Practice: 5 lines at 2 USDT each. What is the total cost? No wager is placed.'),options:choice(['2 USDT','2 USDT'],['10 USDT','10 USDT'],['20 USDT','20 USDT']),correct:'1'},
];
function questions(day:string):Question[]{
 const n=Math.floor(Date.parse(day+'T00:00:00Z')/86400000),a=3+n%8,b=4+n%6;
 return [...lessons,
  {id:'daily-cargo',kind:'daily',reward:50,title:text('Груз дня','Daily cargo'),question:text(`В сундуке ${a} монет, на карте ещё ${b}. Сколько монет всего? Это бесплатная задача.`,`A chest has ${a} coins and the map shows ${b} more. How many in total? This is a free puzzle.`),options:choice([String(a+b+1),String(a+b+1)],[String(a+b),String(a+b)],[String(Math.abs(a-b)),String(Math.abs(a-b))]),correct:'1'},
  {id:'daily-course',kind:'daily',reward:50,title:text('Курс дня','Daily course'),question:n%2===0?text('Как оплачивается комбинация на линии?','How does a line pay?'):text('Сколько клеток занимает блок 3×3?','How many cells does a 3×3 block occupy?'),options:n%2===0?choice(['Самая длинная цепочка от левого края','The longest chain from the left'],['Любые символы в разных местах','Any symbols anywhere'],['Только крайний правый символ','Only the rightmost symbol']):choice(['Девять','Nine'],['Шесть','Six'],['Три','Three']),correct:'0'},
 ];
}
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
  const completed=await this.db.prepare('SELECT challenge_key,reward FROM caribbean_crew_completed WHERE account_id=?').all(account);
  const done=new Set(completed.map(row=>row.challenge_key)),day=crewDay(this.now());
  return{version:1,accountId:account,revision:profile.revision,day,nextResetAt:Date.parse(day+'T00:00:00+03:00')+86400000,tokens:completed.reduce((n,row)=>n+row.reward,0)-owned.reduce((n,row)=>n+row.cost,0),unlockCost:CREW_UNLOCK_COST,owned:CREW_IDS.filter(id=>owned.some(row=>row.character_id===id)),selected:profile.selected_id,challenges:questions(day).map(({correct,...question})=>({...question,completed:done.has(question.kind==='daily'?day+':'+question.id:question.id)}))};
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
   const state=await this.view(account);let changed=false,reward=0,unlocked:CrewCollection['selected']|undefined;
   if(request.action==='answer'){
    const question=questions(state.day).find(q=>q.id===request.challengeId);if(!question)throw new CrewCollectionError(400,'invalid-challenge');
    if(question.kind==='daily'&&request.day!==state.day)fail(409,'day-changed');
    if(request.answer!==question.correct)fail(422,'incorrect-answer');
    const key=question.kind==='daily'?state.day+':'+question.id:question.id;
    changed=!!(await this.db.prepare('INSERT INTO caribbean_crew_completed(account_id,challenge_key,reward,completed_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(account,key,question.reward,this.now())).changes;
    if(changed)reward=question.reward;
   }else if(request.action==='unlock'){
    if(!state.owned.includes(request.characterId as typeof state.selected)){
     if(state.tokens<CREW_UNLOCK_COST)fail(409,'not-enough-tokens');
     await this.db.prepare('INSERT INTO caribbean_crew_owned(account_id,character_id,cost,unlocked_at) VALUES(?,?,?,?)').run(account,request.characterId,CREW_UNLOCK_COST,this.now());changed=true;unlocked=request.characterId as CrewCollection['selected'];
    }
   }else{
    if(!state.owned.includes(request.characterId as typeof state.selected))fail(403,'captain-locked');
    if(state.selected!==request.characterId){await this.db.prepare('UPDATE caribbean_crew_profiles SET selected_id=? WHERE account_id=?').run(request.characterId,account);changed=true;}
   }
   if(changed)await this.db.prepare('UPDATE caribbean_crew_profiles SET revision=revision+1 WHERE account_id=?').run(account);
   await this.db.prepare('INSERT INTO caribbean_crew_requests(account_id,request_id,request_key) VALUES(?,?,?)').run(account,request.id,requestKey);
   return{...await this.view(account),receipt:{requestId:request.id,reward,...(unlocked?{unlocked}:{})}};
  },{lockKey:'crew:'+account});
 }
}
