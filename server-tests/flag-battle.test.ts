import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startFlagBattle } from '../server/games/flagBattle';
import { FLAG_BETS, FLAG_MODES, flagCountries, flagModeInfo, FLAG_GAME, flagPayout, validFlagSession, validFlagView } from '../src/shared/flagBattle';
import { validExpansionAction } from '../src/shared/casinoExpansion';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';

const operation = (country = 'RU', stakeUnits = '100') => ({id:randomUUID(),gameId:FLAG_GAME,action:'start',stakeUnits,settings:{flags:{country}}});
test('every country and allowed stake has exact 96% RTP, with all possible winners replayed',()=>{
  for(const mode of [undefined,...FLAG_MODES.map(m=>m.id)])for(const c of flagCountries(mode))for(const stake of FLAG_BETS){
    const roster=flagCountries(mode),count=roster.length;
    let total=0n;
    for(let winner=0;winner<count;winner++){
      let first=true;
      const view=startFlagBattle({flags:mode===undefined?{country:c.id}:{country:c.id,mode}},stake,max=>{if(first){first=false;return winner;}return max-1;});
      assert(validFlagView(view));assert.equal(view.order.at(-1),roster[winner].id);
      total+=view.order.at(-1)===c.id?BigInt(flagPayout(stake,mode)):0n;
    }
    assert.equal(total*100n,BigInt(stake)*BigInt(count)*96n);
  }
});
test('rejects invalid stakes, countries, extra input, paid moves and malformed randomness',()=>{
  for(const input of [{...operation(),stakeUnits:'101'},operation('ZZ'),{...operation(),settings:{flags:{country:'RU',boost:1}}},{...operation(),action:'move',move:'cashout'}]){
    if(input.stakeUnits==='101')assert.throws(()=>startFlagBattle(input.settings as any,'101'));
    else assert.equal(validExpansionAction(input),false);
  }
  for(const n of [-1,12,.5,NaN,Infinity])assert.throws(()=>startFlagBattle({flags:{country:'RU'}},'100',()=>n));
  for(const settings of [{flags:{country:'ES'}},{flags:{country:'KE',mode:'expanded'}},{flags:{country:'RU',mode:'bad'}},{flags:{country:'RU',mode:'world',boost:2}}])assert.throws(()=>startFlagBattle(settings as any,'100'));
  const v=startFlagBattle({flags:{country:'RU'}},'100',()=>0);
  assert(!validFlagView({...v,order:Array(12).fill('RU')}));
});
test('common wallet settles once, recovers across store restart, rejects mutations and isolates accounts',async()=>{
  const db=new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet=new DemoWalletStore(db);let draws=0;
  const create=()=>new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>{draws++;return 0;});
  try{
    await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1000});
    const store=create(),before=await demoBalanceUnits(db,'alice'),op=operation();
    const replies=await Promise.all(Array.from({length:4},()=>store.operate('alice',op)));
    assert.equal(replies.filter(r=>!r.replayed).length,1);
    const s=replies[0].session;assert(validFlagSession(s));
    assert.equal(s.returnedUnits,'1152');assert.equal(await demoBalanceUnits(db,'alice'),before-100+1152);assert.equal(await demoReservedUnits(db,'alice'),0);
    const count=draws,retry=await create().operate('alice',op);assert(retry.replayed);assert.equal(draws,count);assert.deepEqual(retry.session,s);
    const restored=await create().active('alice');assert.deepEqual(restored.sessions.find(s=>s.gameId===FLAG_GAME),s);
    assert.equal((await store.active('bob')).sessions.length,0);
    await assert.rejects(store.operate('alice',{...op,settings:{flags:{country:'JP'}}}));
    await assert.rejects(store.operate('alice',{...op,stakeUnits:'200'}));
    await assert.rejects(store.operate('alice',{...operation(),stakeUnits:'101'}));
    assert.equal(await demoBalanceUnits(db,'alice'),before-100+1152);
    assert(!validFlagSession({...s,returnedUnits:'1153'}));
    const legacy=await store.active('alice',true,true,true,true,true,true,true,2,4,true,false,false);assert(!legacy.sessions.some(s=>s.gameId===FLAG_GAME));
    await assert.rejects(store.operate('alice',operation(),2,true,true,true,true,true,true,true,true,2,4,true,false,false));
    const loss=await store.operate('alice',operation('JP','500'));assert(validFlagSession(loss.session));assert.equal(loss.session.returnedUnits,'0');
    assert.equal(await demoBalanceUnits(db,'alice'),before-100+1152-500);
  }finally{await db.close();}
});

test('mode settlement, ownership and capability 1 restore preserve immutable legacy rounds',async()=>{
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet=new DemoWalletStore(db),create=()=>new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>0);
  const act=(store:DemoExpansionStore,op:unknown,cap:boolean|2=2)=>store.operate('alice',op,2,true,true,true,true,true,true,true,true,2,4,true,false,cap);
  const active=(store:DemoExpansionStore,cap:boolean|2=2)=>store.active('alice',true,true,true,true,true,true,true,2,4,true,false,cap);
  try{
    await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1000});const store=create();
    const old=await act(store,operation());assert.equal(old.session.rulesVersion,1);const original=structuredClone(old.session);
    for(const mode of FLAG_MODES){
      const op={...operation(),settings:{flags:{country:'RU',mode:mode.id}}},before=await demoBalanceUnits(db,'alice');
      await assert.rejects(act(store,op,true));assert.equal(await demoBalanceUnits(db,'alice'),before);
      const replies=await Promise.all(Array.from({length:3},()=>act(store,op)));assert.equal(replies.filter(r=>!r.replayed).length,1);
      const session=replies[0].session;assert(validFlagSession(session));assert.equal(session.rulesVersion,2);assert.equal(session.view.flags!.order.length,mode.count);
      assert.equal(session.returnedUnits,flagPayout('100',mode.id));assert.equal(await demoBalanceUnits(db,'alice'),before-100+Number(flagPayout('100',mode.id)));
      assert.equal(await demoReservedUnits(db,'alice'),0);assert.deepEqual((await act(create(),op)).session,session);
      assert.deepEqual((await active(create())).sessions.find(s=>s.gameId===FLAG_GAME),session);assert(!(await active(store,true)).sessions.some(s=>s.gameId===FLAG_GAME));
      await assert.rejects(act(store,{...op,settings:{flags:{country:'RU',mode:mode.id==='world'?'classic':'world'}}}));
      assert(!validFlagSession({...session,rulesVersion:1}));assert(!validFlagSession({...session,returnedUnits:'1152'} )||mode.id==='classic');
      const loss=await act(store,{...op,id:randomUUID(),settings:{flags:{country:flagCountries(mode.id).at(-1)!.id,mode:mode.id}}});assert.equal(loss.session.returnedUnits,'0');
    }
    assert.deepEqual((await act(create(),{...operation(),id:original.id})).session,original);
    assert.equal((await create().active('bob')).sessions.length,0);
  }finally{await db.close();}
});
