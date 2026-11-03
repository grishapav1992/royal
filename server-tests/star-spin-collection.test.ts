import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PostgresDatabase} from '../server/database';
import {StarSpinCollectionStore,StarCollectionError} from '../server/starSpinCollection';
import {installStarSpinCollection} from '../server/starSpinCollectionRoutes';
import {DemoWalletStore} from '../server/demoWallet';
import {STAR_CHARACTERS,type StarCollection,type StarRequest} from '../src/shared/starSpinCollection';
import {WILD_NUDGE_STAKES} from '../src/shared/wildNudgeMath';
import {startWildNudge,moveWildNudge} from '../server/games/wildNudge';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
async function fixture(){const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts(id) VALUES('alice'),('bob')");let now=Date.parse('2026-11-01T20:59:00Z');const clock=()=>now,store=new StarSpinCollectionStore(db,undefined,clock);await store.ready;return{db,store,clock,midnight:()=>now+=60000};}
const op=(body:Omit<StarRequest,'id'>|Record<string,unknown>)=>({id:randomUUID(),...body});
async function complete(store:StarSpinCollectionStore){let s=await store.snapshot('alice');for(const q of s.challenges.filter(q=>!q.completed)){for(const answer of q.options){try{s=await store.operate('alice',op({action:'answer',challengeId:q.id,day:s.day,answer:answer.id}));break;}catch(e){if(!(e instanceof StarCollectionError&&e.code==='incorrect-answer'))throw e;}}}return s;}
test('both factions, four unique adult companions and all unlocks work without a wager or wallet change',async()=>{
 const f=await fixture(),wallet=new DemoWalletStore(f.db);try{const before=await wallet.snapshot('alice'),s=await f.store.snapshot('alice');assert.equal(s.side,null);assert.equal(s.selected,null);assert.deepEqual(s.owned,['lyra','vespera']);assert.equal(s.tokens,0);
  const light=await f.store.operate('alice',op({action:'side',side:'light'}));assert.equal(light.selected,'lyra');
  await assert.rejects(f.store.operate('alice',op({action:'select',characterId:'aeliri'})),(e:any)=>e.code==='character-locked');
  assert.equal((await complete(f.store)).tokens,200);
  for(const c of STAR_CHARACTERS.filter(c=>c.cost>0)){const r=op({action:'unlock',characterId:c.id});const first=await f.store.operate('alice',r),repeat=await f.store.operate('alice',r);assert.equal(first.tokens,repeat.tokens);assert.equal(first.receipt?.unlocked,c.id);assert.equal(repeat.receipt,undefined);await f.store.operate('alice',op({action:'select',characterId:c.id}));}
  let selected=await f.store.operate('alice',op({action:'side',side:'light'}));assert.equal(selected.selected,'aeliri');selected=await f.store.operate('alice',op({action:'side',side:'dark'}));assert.equal(selected.selected,'nyxara');assert.equal(selected.tokens,0);assert.deepEqual(selected.owned,STAR_CHARACTERS.map(c=>c.id));
  const restored=await new StarSpinCollectionStore(f.db,undefined,f.clock).snapshot('alice');assert.deepEqual(restored,await f.store.snapshot('alice'));assert.deepEqual(await wallet.snapshot('alice'),before);assert.deepEqual((await f.store.snapshot('bob')).owned,['lyra','vespera']);
 }finally{await f.db.close();}
});
test('concurrent rewards and unlocks are serialized and UUIDs cannot change meaning',async()=>{
 const f=await fixture();try{const s=await f.store.snapshot('alice'),answer={action:'answer',challengeId:'lesson-side',day:s.day,answer:'0'};await Promise.all(Array.from({length:12},()=>f.store.operate('alice',op(answer))));assert.equal((await f.store.snapshot('alice')).tokens,50);
  const id=randomUUID();await f.store.operate('alice',{id,action:'side',side:'light'});await assert.rejects(f.store.operate('alice',{id,action:'side',side:'dark'}),(e:any)=>e.code==='request-conflict');
  await complete(f.store);await Promise.all(Array.from({length:8},()=>f.store.operate('alice',op({action:'unlock',characterId:'aeliri'}))));const final=await f.store.snapshot('alice');assert.equal(final.tokens,100);assert.equal(final.owned.filter(id=>id==='aeliri').length,1);
 }finally{await f.db.close();}
});
test('Moscow daily reset keeps permanent lessons and old requests cannot regrant tokens',async()=>{
 const f=await fixture();try{const s=await complete(f.store);assert.equal(s.day,'2026-11-01');f.midnight();const next=await f.store.snapshot('alice');assert.equal(next.day,'2026-11-02');assert(next.challenges.filter(q=>q.kind==='lesson').every(q=>q.completed));assert(next.challenges.filter(q=>q.kind==='daily').every(q=>!q.completed));await assert.rejects(f.store.operate('alice',op({action:'answer',challengeId:'daily-archive',day:s.day,answer:'0'})),(e:any)=>e.code==='day-changed');assert.equal((await complete(f.store)).tokens,250);
 }finally{await f.db.close();}
});
test('forged ownership, currencies, factions and reward amounts never change collection',async()=>{
 const f=await fixture();try{const before=await f.store.snapshot('alice');for(const body of [{action:'unlock',characterId:'aeliri',cost:0},{action:'side',side:'other'},{action:'select',characterId:'not-a-character'},{action:'select',characterId:'lyra',accountId:'bob'},{action:'answer',challengeId:'lesson-side',day:before.day,answer:'0',reward:10000},{action:'answer',challengeId:'lesson-side',day:before.day,answer:'2'}])await assert.rejects(f.store.operate('alice',op(body)));assert.deepEqual(await f.store.snapshot('alice'),before);
 }finally{await f.db.close();}
});
test('every companion choice preserves every allowed full paid round including all bonus continuations',async()=>{
 const f=await fixture();try{await complete(f.store);for(const c of STAR_CHARACTERS.filter(c=>c.cost))await f.store.operate('alice',op({action:'unlock',characterId:c.id}));
  function round(stake:string,trace:number[]){const tickets=trace.slice();let r=startWildNudge({wildNudge:{mode:'normal'}},stake,()=>tickets.shift()!);while(!r.ended)r=moveWildNudge(structuredClone(r.view),stake,r.view.revision,'wild-nudge-spin',()=>tickets.shift()!);assert.equal(tickets.length,0);return r;}
  for(const stake of WILD_NUDGE_STAKES)for(const trace of [[30,30,30,30,30],[1,2,62,63,30],[2,45,2,16,14,...Array(40).fill(2)]]){const baseline=round(stake,trace);for(const c of STAR_CHARACTERS){await f.store.operate('alice',op({action:'select',characterId:c.id}));assert.deepEqual(round(stake,trace),baseline);}}
 }finally{await f.db.close();}
});
test('collection API uses shared cookie identity, owner guard, no-store and same-origin controls',async()=>{
 const f=await fixture(),app=express();installStarSpinCollection(app,f.store,async token=>token==='alice'?{account:{id:'alice',skin:0}}:null);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port+'/api/star-spin/collection',headers={Cookie:'royal_session=alice',[WALLET_ACCOUNT_HEADER]:'alice'};
 try{assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{...headers,[WALLET_ACCOUNT_HEADER]:'bob'}})).status,409);const get=await fetch(url,{headers});assert.equal(get.status,200);assert.match(get.headers.get('cache-control')!,/no-store/);assert.equal((await get.json() as StarCollection).accountId,'alice');assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://other.invalid','Content-Type':'application/json'},body:JSON.stringify(op({action:'side',side:'light'}))})).status,403);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await f.db.close();}
});
