import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { JACKIE_GAME, validJackieSession, validJackieSettings, JACKIE_COSTUMES, JACKIE_LOCATIONS, type JackieCostume, type JackieLocation } from '../src/shared/jackieChan';
import { startJackie, moveJackie } from '../server/games/jackieChan';
import { startPenalty, movePenalty } from '../server/games/crLeo';
import { validExpansionAction } from '../src/shared/casinoExpansion';
import type { PenaltyRisk } from '../src/shared/crLeo';

const settings=(risk:PenaltyRisk='safe',costume:JackieCostume='master',location:JackieLocation='restaurant')=>({jackie:{risk,costume,location}});
const start=(costume:JackieCostume='master')=>({id:randomUUID(),gameId:JACKIE_GAME,action:'start' as const,stakeUnits:'50000',settings:settings('safe',costume)});
async function setup(){
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet=new DemoWalletStore(db,()=>0);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:10000});
  let success=true,draws=0;const store=new DemoExpansionStore(db,async id=>({balance:await demoBalanceUnits(db,id)/100,entries:[]}),wallet.ready,async()=>{},max=>{if(max===100){draws++;return success?0:99;}return 0;});await store.ready;
  const act=(account:string,value:unknown)=>store.operate(account,value,2,true,true,true,true,true,true,true,true,2,4,true,true);
  return{db,wallet,store,act,draws:()=>draws,success:(v:boolean)=>success=v};
}
test('all cosmetic choices preserve the exact original CR vs Leo outcome, cost and payout at every step',()=>{
  for(const costume of JACKIE_COSTUMES)for(const location of JACKIE_LOCATIONS)for(const lossAt of [0,1,2,3,4,5]){
    const draw=()=>{let index=0;return(max:number)=>max===100?(index++===lossAt?99:0):0;};
    let jackie=startJackie(settings('safe',costume.id,location.id),'1000',90000,draw()),penalty=startPenalty({penalty:{hero:'cr',risk:'safe'}},'1000',draw());
    const jd=draw(),pd=draw();
    while(jackie.combat.status==='playing'){
      assert.deepEqual(jackie.combat,penalty);const risk=(['extreme','sharp','safe'] as const)[jackie.combat.revision%3];
      jackie=moveJackie(jackie,'1000','jackie-fight',jackie.combat.revision,jd,risk);penalty=movePenalty(penalty,'1000','penalty-kick',penalty.revision,pd,risk);
    }
    assert.deepEqual(jackie.combat,penalty);
  }
});
test('only declared settings and versioned actions are accepted',()=>{
  assert(validJackieSettings(settings()));assert(validExpansionAction(start()));
  for(const extra of [{opponents:0},{chance:100},{collectionUnits:90000},{hero:'leo'}])assert(!validJackieSettings({jackie:{...settings().jackie,...extra}}));
  assert(!validExpansionAction({...start(),settings:{penalty:{hero:'cr',risk:'safe'}}}));
  assert(!validExpansionAction({id:randomUUID(),gameId:JACKIE_GAME,action:'move',sessionId:randomUUID(),move:'jackie-fight'}));
});
test('one paid series credits collection once for either outcome; continuations and replays never add progress',async()=>{
  const f=await setup();try{
    await assert.rejects(f.act('alice',start('hawk')),/не открыт/);assert.equal(f.draws(),0);
    const op=start(),before=await demoBalanceUnits(f.db,'alice');const first=await f.act('alice',op);assert(validJackieSession(first.session));
    assert.equal(first.session.view.jackie!.collectionUnits,0);assert.equal(await demoBalanceUnits(f.db,'alice'),before-50000);
    await f.act('alice',op);assert.equal(f.draws(),1);
    const move={id:randomUUID(),gameId:JACKIE_GAME,action:'move' as const,sessionId:op.id,move:'jackie-fight',revision:1,penaltyRisk:'extreme' as const};
    const parallel=await Promise.allSettled([f.act('alice',move),f.act('alice',{...move,id:randomUUID()})]);assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);assert.equal(await f.store.jackieCollection.read('alice'),0);
    const bank={id:randomUUID(),gameId:JACKIE_GAME,action:'move' as const,sessionId:op.id,move:'cashout',revision:2};
    const replies=await Promise.all([f.act('alice',bank),f.act('alice',bank)]);assert(replies.every(r=>validJackieSession(r.session)));assert.equal(await f.store.jackieCollection.read('alice'),50000);assert.equal(await demoReservedUnits(f.db,'alice'),0);
    f.success(false);const failed=await f.act('alice',start('police'));assert.equal(failed.session.returnedUnits,'0');assert.equal(failed.session.view.jackie!.collectionUnits,90000);
    const all=await f.act('alice',start('hawk'));assert.equal(all.session.view.jackie!.costume,'hawk');assert.equal(await f.store.jackieCollection.read('alice'),90000);
    assert.equal(await f.store.jackieCollection.read('bob'),0);
  }finally{await f.db.close();}
});
test('old clients cannot start the new game or receive its sessions; accounts and pending rounds stay isolated',async()=>{
  const f=await setup();try{
    const op=start();await assert.rejects(f.store.operate('alice',op),/Обнови/);assert.equal(f.draws(),0);
    const initial=await f.act('alice',op);assert(!((await f.store.active('alice')).sessions.some(s=>s.gameId===JACKIE_GAME)));
    const move={id:randomUUID(),gameId:JACKIE_GAME,action:'move' as const,sessionId:op.id,move:'cashout',revision:1};await assert.rejects(f.act('bob',move));
    const resumed=await f.act('alice',move);assert(validJackieSession(resumed.session));assert.equal(resumed.session.returnedUnits,initial.session.view.jackie!.combat.availableUnits);
    assert(!validJackieSession({...initial.session,view:{...initial.session.view,actions:[{move:'penalty-kick',cost:0,label:'x'},{move:'cashout',cost:0,label:'x'}]}}));
  }finally{await f.db.close();}
});
