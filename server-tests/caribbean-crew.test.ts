import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PostgresDatabase} from '../server/database';
import {CaribbeanCrewStore,CrewCollectionError} from '../server/caribbeanCrew';
import {installCaribbeanCrew} from '../server/caribbeanCrewRoutes';
import {DemoWalletStore} from '../server/demoWallet';
import type {CrewCollection} from '../src/shared/caribbeanCrew';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
async function fixture(){
 const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts(id) VALUES('alice'),('bob')");
 const now=Date.parse('2026-10-28T20:59:00Z');const store=new CaribbeanCrewStore(db,undefined,()=>now);await store.ready;
 return{db,store,request:(action:'unlock'|'select',characterId:string,id=randomUUID())=>({id,action,characterId})};
}
test('the first collection stays readable, but tokens and unlocks moved to the voyage',async()=>{
 const f=await fixture(),wallet=new DemoWalletStore(f.db);try{
  const before=await wallet.snapshot('alice'),start=await f.store.snapshot('alice');
  assert.equal(start.tokens,0);assert.deepEqual(start.owned,['isabella']);assert.equal(start.selected,'isabella');assert.deepEqual(start.challenges,[]);
  const claim={id:randomUUID(),action:'answer' as const,challengeId:'lesson-lines',day:start.day,answer:'0'};
  for(const closed of [claim,f.request('unlock','amara')])await assert.rejects(f.store.operate('alice',closed),e=>e instanceof CrewCollectionError&&e.status===410&&e.code==='collection-moved');
  assert.equal((await f.store.snapshot('alice')).tokens,0);assert.deepEqual(await wallet.snapshot('alice'),before);
 }finally{await f.db.close();}
});
test('an earlier pirate can still be chosen by an open package',async()=>{
 const f=await fixture();try{
  await f.store.snapshot('alice');await f.db.prepare("INSERT INTO caribbean_crew_owned(account_id,character_id,cost,unlocked_at) VALUES('alice','amara',100,1)").run();
  await assert.rejects(f.store.operate('alice',f.request('select','mei')),e=>e instanceof CrewCollectionError&&e.code==='captain-locked');
  const id=randomUUID(),first=await f.store.operate('alice',f.request('select','amara',id));assert.equal(first.selected,'amara');
  assert.equal((await f.store.operate('alice',f.request('select','amara',id))).revision,first.revision);
  await assert.rejects(f.store.operate('alice',f.request('select','isabella',id)),e=>e instanceof CrewCollectionError&&e.code==='request-conflict');
  assert.equal((await f.store.snapshot('bob')).selected,'isabella');
 }finally{await f.db.close();}
});
test('forged currencies, identities and unknown pirates are rejected',async()=>{
 const f=await fixture();try{
  await f.store.snapshot('alice');
  for(const invalid of [{...f.request('unlock','mei'),cost:0},{...f.request('select','mei'),accountId:'bob'},{...f.request('select','unknown')}])await assert.rejects(f.store.operate('alice',invalid));
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
