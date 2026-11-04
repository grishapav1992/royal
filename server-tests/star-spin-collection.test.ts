import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PostgresDatabase} from '../server/database';
import {StarSpinCollectionStore,StarCollectionError} from '../server/starSpinCollection';
import {installStarSpinCollection} from '../server/starSpinCollectionRoutes';
import {DemoWalletStore} from '../server/demoWallet';
import {STAR_CHARACTERS,type StarCollection,type StarRequest} from '../src/shared/starSpinCollection';
import {GAME_STAKE_UNITS} from '../src/shared/gameStakes';
import {startStarSpin,moveStarSpin} from '../src/shared/wildNudgeStakes';
import {WILD_NUDGE_STAKES} from '../src/shared/wildNudgeMath';
import {startWildNudge,moveWildNudge} from '../server/games/wildNudge';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
async function fixture(){const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts(id) VALUES('alice'),('bob')");let now=Date.parse('2026-11-01T20:59:00Z');const clock=()=>now,store=new StarSpinCollectionStore(db,undefined,clock);await store.ready;return{db,store,clock,midnight:()=>now+=60000};}
const op=(body:Omit<StarRequest,'id'>|Record<string,unknown>)=>({id:randomUUID(),...body});
const ids=STAR_CHARACTERS.map(c=>c.id);

test('every account can select all four companions immediately without a wager or wallet change',async()=>{
 const f=await fixture(),wallet=new DemoWalletStore(f.db);try{
  const before=await wallet.snapshot('alice'),s=await f.store.snapshot('alice');
  assert.equal(s.side,null);assert.equal(s.selected,null);assert.deepEqual(s.owned,ids);assert.equal(s.tokens,0);assert.deepEqual(s.challenges,[]);
  for(const c of STAR_CHARACTERS){const selected=await f.store.operate('alice',op({action:'select',characterId:c.id}));assert.equal(selected.selected,c.id);assert.equal(selected.side,c.side);assert.equal(selected.tokens,0);}
  assert.equal((await f.store.operate('alice',op({action:'side',side:'light'}))).selected,'aeliri');
  assert.equal((await f.store.operate('alice',op({action:'side',side:'dark'}))).selected,'nyxara');
  const restored=await new StarSpinCollectionStore(f.db,undefined,f.clock).snapshot('alice');assert.deepEqual(restored,await f.store.snapshot('alice'));
  assert.deepEqual(await wallet.snapshot('alice'),before);const bob=await f.store.snapshot('bob');assert.deepEqual(bob.owned,ids);assert.equal(bob.selected,null);
 }finally{await f.db.close();}
});

test('concurrent grants and legacy unlock requests stay free and UUIDs cannot change meaning',async()=>{
 const f=await fixture();try{
  const snapshots=await Promise.all(Array.from({length:12},()=>f.store.snapshot('alice')));for(const s of snapshots){assert.deepEqual(s.owned,ids);assert.equal(s.revision,0);}
  await Promise.all(Array.from({length:8},()=>f.store.operate('alice',op({action:'unlock',characterId:'aeliri'}))));
  const rows=await f.db.prepare('SELECT character_id,cost FROM star_spin_owned WHERE account_id=?').all('alice');assert.equal(rows.length,4);assert(rows.every(r=>r.cost===0));
  const id=randomUUID();await f.store.operate('alice',{id,action:'side',side:'light'});await assert.rejects(f.store.operate('alice',{id,action:'side',side:'dark'}),(e:any)=>e.code==='request-conflict');
  assert.equal((await f.store.snapshot('alice')).tokens,0);
 }finally{await f.db.close();}
});

test('existing accounts keep favorites, spent tokens and historical UUID recovery when remaining companions become free',async()=>{
 const f=await fixture();try{
  await f.store.snapshot('alice');
  await f.db.prepare('DELETE FROM star_spin_owned WHERE account_id=? AND character_id=?').run('alice','nyxara');
  await f.db.prepare('UPDATE star_spin_owned SET cost=100 WHERE account_id=? AND character_id=?').run('alice','aeliri');
  await f.db.prepare('UPDATE star_spin_profiles SET side=?,light_id=?,dark_id=?,revision=7 WHERE account_id=?').run('light','aeliri','vespera','alice');
  for(const key of ['lesson-side','lesson-wild','lesson-bonus'])await f.db.prepare('INSERT INTO star_spin_completed(account_id,challenge_key,reward,completed_at) VALUES(?,?,50,?)').run('alice',key,f.clock());
  const body={action:'answer',challengeId:'lesson-side',day:'2026-11-01',answer:'0'},id=randomUUID(),key=JSON.stringify(Object.entries(body).sort(([a],[b])=>a.localeCompare(b)));
  await f.db.prepare('INSERT INTO star_spin_requests(account_id,request_id,request_key) VALUES(?,?,?)').run('alice',id,key);
  const s=await f.store.snapshot('alice');assert.equal(s.selected,'aeliri');assert.equal(s.selectedBySide.dark,'vespera');assert.deepEqual(s.owned,ids);assert.equal(s.tokens,50);assert.equal(s.revision,8);assert.deepEqual(s.challenges,[]);
  const repeated=await f.store.snapshot('alice');assert.deepEqual(repeated,s);
  const replay=await f.store.operate('alice',{id,...body});assert.equal(replay.receipt,undefined);assert.deepEqual(replay,s);
  await assert.rejects(f.store.operate('alice',{id,...body,answer:'1'}),(e:any)=>e.code==='request-conflict');
  await assert.rejects(f.store.operate('alice',op(body)),(e:any)=>e instanceof StarCollectionError&&e.status===410&&e.code==='collection-paused');
  const costs=await f.db.prepare('SELECT character_id,cost FROM star_spin_owned WHERE account_id=?').all('alice');assert.equal(costs.find(r=>r.character_id==='aeliri')!.cost,100);assert.equal(costs.find(r=>r.character_id==='nyxara')!.cost,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM star_spin_completed WHERE account_id=?').get('alice'))!.count,3);
  assert.equal((await f.store.operate('alice',op({action:'unlock',characterId:'nyxara'}))).tokens,50);
 }finally{await f.db.close();}
});

test('paused challenges stay unavailable after a daily reset and cannot grant new rewards',async()=>{
 const f=await fixture();try{
  const s=await f.store.snapshot('alice');f.midnight();const next=await f.store.snapshot('alice');assert.notEqual(next.day,s.day);assert.deepEqual(next.challenges,[]);
  for(const challengeId of ['lesson-side','lesson-wild','lesson-bonus','daily-archive'])await assert.rejects(f.store.operate('alice',op({action:'answer',challengeId,day:next.day,answer:'0'})),(e:any)=>e.code==='collection-paused');
  assert.equal((await f.store.snapshot('alice')).tokens,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM star_spin_completed').get())!.count,0);
 }finally{await f.db.close();}
});

test('forged ownership, currencies, factions and reward amounts never change selection or history',async()=>{
 const f=await fixture();try{const before=await f.store.snapshot('alice');for(const body of [{action:'unlock',characterId:'aeliri',cost:0},{action:'side',side:'other'},{action:'select',characterId:'not-a-character'},{action:'select',characterId:'lyra',accountId:'bob'},{action:'answer',challengeId:'lesson-side',day:before.day,answer:'0',reward:10000},{action:'answer',challengeId:'lesson-side',day:before.day,answer:'2'}])await assert.rejects(f.store.operate('alice',op(body)));assert.deepEqual(await f.store.snapshot('alice'),before);
 }finally{await f.db.close();}
});

test('all four available companions preserve every common-stake full round and historical bonus continuation',async()=>{
 const f=await fixture();try{
  function round(stake:string,trace:number[],legacy:boolean){const tickets=trace.slice();let r=legacy?startWildNudge({wildNudge:{mode:'normal'}},stake,()=>tickets.shift()!):startStarSpin({wildNudge:{mode:'normal'}},stake,()=>tickets.shift()!);while(!r.ended)r=legacy?moveWildNudge(structuredClone(r.view),stake,r.view.revision,'wild-nudge-spin',()=>tickets.shift()!):moveStarSpin(structuredClone(r.view),stake,r.view.revision,'wild-nudge-spin',()=>tickets.shift()!);assert.equal(tickets.length,0);return r;}
  for(const [legacy,stakes] of [[false,GAME_STAKE_UNITS],[true,WILD_NUDGE_STAKES]] as const)for(const stake of stakes)for(const trace of [[30,30,30,30,30],[1,2,62,63,30],[2,45,2,16,14,...Array(40).fill(2)]]){const baseline=round(stake,trace,legacy);for(const c of STAR_CHARACTERS){await f.store.operate('alice',op({action:'select',characterId:c.id}));assert.deepEqual(round(stake,trace,legacy),baseline);}}
 }finally{await f.db.close();}
});

test('selection API keeps cookie identity, owner guard, no-store and same-origin controls',async()=>{
 const f=await fixture(),app=express();installStarSpinCollection(app,f.store,async token=>token==='alice'?{account:{id:'alice',skin:0}}:null);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port+'/api/star-spin/collection',headers={Cookie:'royal_session=alice',[WALLET_ACCOUNT_HEADER]:'alice'};
 try{assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{...headers,[WALLET_ACCOUNT_HEADER]:'bob'}})).status,409);const get=await fetch(url,{headers});assert.equal(get.status,200);assert.match(get.headers.get('cache-control')!,/no-store/);const data=await get.json() as StarCollection;assert.deepEqual(data.owned,ids);assert.deepEqual(data.challenges,[]);assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://other.invalid','Content-Type':'application/json'},body:JSON.stringify(op({action:'side',side:'light'}))})).status,403);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await f.db.close();}
});
