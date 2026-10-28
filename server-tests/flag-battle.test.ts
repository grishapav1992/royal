import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startFlagBattle } from '../server/games/flagBattle';
import { FLAG_BETS, FLAG_COUNTRIES, FLAG_GAME, flagPayout, validFlagSession, validFlagView } from '../src/shared/flagBattle';
import { validExpansionAction } from '../src/shared/casinoExpansion';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';

const operation = (country = 'RU', stakeUnits = '100') => ({id:randomUUID(),gameId:FLAG_GAME,action:'start',stakeUnits,settings:{flags:{country}}});
test('every country and allowed stake has exact 96% RTP, with all possible winners replayed',()=>{
  for(const c of FLAG_COUNTRIES)for(const stake of FLAG_BETS){
    let total=0n;
    for(let winner=0;winner<12;winner++){
      let first=true;
      const view=startFlagBattle({flags:{country:c.id}},stake,max=>{if(first){first=false;return winner;}return max-1;});
      assert(validFlagView(view));assert.equal(view.order[11],FLAG_COUNTRIES[winner].id);
      total+=view.order[11]===c.id?BigInt(flagPayout(stake)):0n;
    }
    assert.equal(total*100n,BigInt(stake)*12n*96n);
  }
});
test('rejects invalid stakes, countries, extra input, paid moves and malformed randomness',()=>{
  for(const input of [{...operation(),stakeUnits:'101'},operation('ZZ'),{...operation(),settings:{flags:{country:'RU',boost:1}}},{...operation(),action:'move',move:'cashout'}]){
    if(input.stakeUnits==='101')assert.throws(()=>startFlagBattle(input.settings as any,'101'));
    else assert.equal(validExpansionAction(input),false);
  }
  for(const n of [-1,12,.5,NaN,Infinity])assert.throws(()=>startFlagBattle({flags:{country:'RU'}},'100',()=>n));
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
    const legacy=await store.active('alice',true,true,true,true,true,true,true,2,4,true,false);assert(!legacy.sessions.some(s=>s.gameId===FLAG_GAME));
    await assert.rejects(store.operate('alice',operation(),2,true,true,true,true,true,true,true,true,2,4,true,false));
    const loss=await store.operate('alice',operation('JP','500'));assert(validFlagSession(loss.session));assert.equal(loss.session.returnedUnits,'0');
    assert.equal(await demoBalanceUnits(db,'alice'),before-100+1152-500);
  }finally{await db.close();}
});
