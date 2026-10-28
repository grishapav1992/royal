import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PostgresDatabase} from '../server/database';
import {CaribbeanCrewStore,CrewCollectionError} from '../server/caribbeanCrew';
import {installCaribbeanCrew} from '../server/caribbeanCrewRoutes';
import {DemoWalletStore} from '../server/demoWallet';
import {CREW_IDS,type CrewCollection} from '../src/shared/caribbeanCrew';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
async function fixture(){
 const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts(id) VALUES('alice'),('bob')");
 let now=Date.parse('2026-10-28T20:59:00Z');const store=new CaribbeanCrewStore(db,undefined,()=>now);await store.ready;
 return{db,store,nextDay:()=>{now+=86400000;},midnight:()=>{now+=60000;},request:(action:'unlock'|'select',characterId:string,id=randomUUID())=>({id,action,characterId})};
}
async function answerAll(store:CaribbeanCrewStore,account='alice'){
 let state=await store.snapshot(account);
 for(const question of state.challenges.filter(q=>!q.completed)){
  let answered=false;
  for(const option of question.options){
   try{state=await store.operate(account,{id:randomUUID(),action:'answer',challengeId:question.id,day:state.day,answer:option.id});answered=true;break;}
   catch(error){if(!(error instanceof CrewCollectionError&&error.code==='incorrect-answer'))throw error;}
  }
  assert(answered);
 }
 return state;
}
test('free lessons and daily puzzles unlock a chosen captain without touching the common wallet',async()=>{
 const f=await fixture(),wallet=new DemoWalletStore(f.db);try{
  const before=await wallet.snapshot('alice'),start=await f.store.snapshot('alice');assert.equal(start.tokens,0);assert.deepEqual(start.owned,['isabella']);assert.equal(start.selected,'isabella');assert.equal(start.challenges.length,7);
  await assert.rejects(f.store.operate('alice',f.request('unlock','amara')),e=>e instanceof CrewCollectionError&&e.code==='not-enough-tokens');
  await assert.rejects(f.store.operate('alice',f.request('select','amara')),e=>e instanceof CrewCollectionError&&e.code==='captain-locked');
  const earned=await answerAll(f.store);assert.equal(earned.tokens,200);assert(earned.challenges.every(q=>q.completed));
  const id=randomUUID(),unlock=f.request('unlock','amara',id),opened=await f.store.operate('alice',unlock);assert.equal(opened.tokens,100);assert.deepEqual(opened.owned,['isabella','amara']);assert.equal(opened.receipt?.unlocked,'amara');
  const repeated=await f.store.operate('alice',unlock);assert.equal(repeated.tokens,100);assert(!repeated.receipt);assert.equal((await f.store.operate('alice',f.request('unlock','amara'))).tokens,100);
  await f.store.operate('alice',f.request('select','amara'));const restored=new CaribbeanCrewStore(f.db);assert.equal((await restored.snapshot('alice')).selected,'amara');assert.deepEqual(await wallet.snapshot('alice'),before);
  assert.deepEqual((await f.store.snapshot('bob')).owned,['isabella']);assert.equal((await f.store.snapshot('bob')).tokens,0);
  await assert.rejects(f.store.operate('alice',f.request('unlock','mei',id)),e=>e instanceof CrewCollectionError&&e.code==='request-conflict');
 }finally{await f.db.close();}
});
test('concurrent claims and unlocks cannot duplicate rewards or spend more tokens than earned',async()=>{
 const f=await fixture();try{
  const s=await f.store.snapshot('alice'),claim={id:randomUUID(),action:'answer' as const,challengeId:'lesson-lines',day:s.day,answer:'0'};
  await Promise.all(Array.from({length:8},()=>f.store.operate('alice',{...claim,id:randomUUID()})));assert.equal((await f.store.snapshot('alice')).tokens,20);
  await answerAll(f.store);const claims=await Promise.allSettled(['amara','mei','priya','yasmin'].map(id=>f.store.operate('alice',f.request('unlock',id))));
  assert.equal(claims.filter(v=>v.status==='fulfilled').length,2);const state=await f.store.snapshot('alice');assert.equal(state.tokens,0);assert.equal(state.owned.length,3);
 }finally{await f.db.close();}
});
test('daily tasks reset at Moscow midnight while lessons and all ten unlocks stay permanent',async()=>{
 const f=await fixture();try{
  let state=await answerAll(f.store);assert.equal(state.day,'2026-10-28');const previousDay=state.day;
  f.midnight();state=await f.store.snapshot('alice');assert.equal(state.day,'2026-10-29');assert(state.challenges.filter(q=>q.kind==='lesson').every(q=>q.completed));assert(state.challenges.filter(q=>q.kind==='daily').every(q=>!q.completed));
  await assert.rejects(f.store.operate('alice',{id:randomUUID(),action:'answer',challengeId:'daily-course',day:previousDay,answer:'0'}),e=>e instanceof CrewCollectionError&&e.code==='day-changed');
  for(let day=0;day<9;day++){
   await answerAll(f.store);state=await f.store.snapshot('alice');
   for(const id of CREW_IDS.filter(id=>!state.owned.includes(id))){if(state.tokens<100)break;state=await f.store.operate('alice',f.request('unlock',id));}
   f.nextDay();
  }
  state=await f.store.snapshot('alice');assert.deepEqual(state.owned,[...CREW_IDS]);assert(state.tokens>=0);
 }finally{await f.db.close();}
});
test('forged currencies, rewards, identities and invalid quiz answers are rejected',async()=>{
 const f=await fixture();try{
  const s=await f.store.snapshot('alice');
  for(const invalid of [{...f.request('unlock','mei'),cost:0},{...f.request('unlock','mei'),accountId:'bob'},{...f.request('unlock','unknown')},{id:randomUUID(),action:'answer',challengeId:'unknown',day:s.day,answer:'0'},{id:randomUUID(),action:'answer',challengeId:'lesson-giant',day:s.day,answer:'0'},{id:randomUUID(),action:'answer',challengeId:'lesson-lines',day:s.day,answer:'0',reward:10000}])await assert.rejects(f.store.operate('alice',invalid));
  assert.equal((await f.store.snapshot('alice')).tokens,0);
 }finally{await f.db.close();}
});
test('collection HTTP uses the authenticated account, uncached responses and origin guards',async()=>{
 const f=await fixture(),app=express();installCaribbeanCrew(app,f.store,async token=>token==='alice'?{account:{id:'alice',skin:0}}:null);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const port=(server.address() as {port:number}).port,base='http://127.0.0.1:'+port+'/api/caribbean-crew';
 try{
  assert.equal((await fetch(base)).status,401);
  assert.equal((await fetch(base,{headers:{Cookie:'royal_session=alice',[WALLET_ACCOUNT_HEADER]:'bob'}})).status,409);
  const headers={Cookie:'royal_session=alice',[WALLET_ACCOUNT_HEADER]:'alice'};
  const snapshot=await fetch(base,{headers});assert.equal(snapshot.status,200);assert.match(snapshot.headers.get('cache-control')!,/no-store/);assert.equal((await snapshot.json() as CrewCollection).tokens,0);
  assert.equal((await fetch(base,{method:'POST',headers:{...headers,Origin:'https://other.invalid','Content-Type':'application/json'},body:JSON.stringify(f.request('select','isabella'))})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(f.request('select','amara'))})).status,403);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await f.db.close();}
});
