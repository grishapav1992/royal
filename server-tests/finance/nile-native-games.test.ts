import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pvpFixture} from './helpers/nile-pvp-fixture';
import {block} from './helpers/nile-play-fixture';
import {NileGameRuntime,type NativeCommand} from '../../server/finance/nile-game-runtime';
import {seededRandom} from '../../src/shared/draconaMath';
import {validDraconaSession} from '../../src/shared/dracona';
import {validNeopolisSession} from '../../src/shared/neopolis';
import {validAfterSession} from '../../src/shared/afterglow';
import {savedTower,seedNativeTower} from '../helpers/removed-tower';

const command=(path:string,body:unknown=null,method:'GET'|'POST'=body===null?'GET':'POST'):NativeCommand=>({path,body,method,flags:Array(9).fill(true),rules:2,query:{}});
const draconaCommand=(body:unknown=null):NativeCommand=>({...command('/expansion',body),flags:[true,true,true,true,true,true,true,true,2]});
const neopolisCommand=(body:unknown=null):NativeCommand=>({...draconaCommand(body),neopolisRules:4});
async function setup(){const c=await pvpFixture();await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());const games=new NileGameRuntime(c.ledger,()=>0);await games.ready;return{...c,games};}

test('published Neopolis restores all three bosses and settles its campaign once in the common Nile journal',async()=>{
 const c=await setup();try{
  const random=seededRandom(95),draw=(max:number)=>Math.floor(random()*max);
  let games=new NileGameRuntime(c.ledger,draw),reply:any;
  const start=()=>({id:randomUUID(),action:'start',gameId:'studio-neopolis',stakeUnits:'1000',settings:{neopolis:{hero:'granite'}}});
  await assert.rejects(games.run(c.a,command('/expansion',start())),/refresh/);
  let expected=200000000n,previous:any;
  for(let i=0;i<35;i++){
   const op={...start(),stakeUnits:i%2?'2000':'1000'};reply=await games.run(c.a,neopolisCommand(op));assert(validNeopolisSession(reply.session));
   if(previous&&!previous.view.neopolis.team.complete)assert.deepEqual(reply.session.view.neopolis.origin,previous.view.neopolis.team);
   assert.equal(reply.session.stakeUnits,op.stakeUnits);previous=reply.session;
   expected-=BigInt(op.stakeUnits)*10000n;expected+=BigInt(reply.session.returnedUnits)*10000n;
   assert.equal(reply.wallet.balanceUnits,String(expected));if(reply.session.state==='active')break;
  }
  assert.equal(reply.session.state,'active');const id=reply.session.id,bonusBalance=expected,acceptedStake=reply.session.stakeUnits;
  games=new NileGameRuntime(c.ledger,draw);
  const hidden=await games.run(c.a,command('/expansion'))as any;assert(!hidden.sessions.some((s:any)=>s.id===id));
  const restored=await games.run(c.a,neopolisCommand())as any;assert.deepEqual(restored.sessions.find((s:any)=>s.id===id),reply.session);
  let last:unknown;const seen=new Set<number>();
  while(reply.session.state==='active'){
   const view=reply.session.view.neopolis;seen.add(view.battle.boss);
   last={id:randomUUID(),action:'move',gameId:'studio-neopolis',sessionId:id,move:'neopolis-spin',revision:view.revision};
   await assert.rejects(games.run(c.a,neopolisCommand({...last as object,stakeUnits:'50000'})));
   reply=await games.run(c.a,neopolisCommand(last));assert(validNeopolisSession(reply.session));
   assert.equal(reply.session.stakeUnits,acceptedStake);
   if(reply.session.state==='active')assert.equal(reply.wallet.balanceUnits,String(bonusBalance));
  }
  assert.deepEqual([...seen].sort(),[0,1,2]);expected+=BigInt(reply.session.returnedUnits)*10000n;
  assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(reply.wallet.reservedUnits,'0');
  const replay=await games.run(c.a,neopolisCommand(last))as any;assert(replay.replayed);assert.equal(replay.wallet.balanceUnits,String(expected));
  await c.ledger.audit();
 }finally{await c.close();}
});

for(const seed of [1,5])test(`rebalanced Dracona seed ${seed} retains exact cents, recovery and one settlement in the Nile journal`,async()=>{
 const c=await setup();try{
  const random=seededRandom(seed);let draws:number=0;
  let games=new NileGameRuntime(c.ledger,max=>{draws++;return Math.floor(random()*max);});
  const start={id:randomUUID(),action:'start',gameId:'studio-dracona',stakeUnits:'1000',settings:{dracona:{mode:'normal'}}};
  await assert.rejects(games.run(c.a,command('/expansion',start)),/Обнови|refresh/);assert.equal(draws,0);
  const initial=await games.run(c.a,draconaCommand(start))as any;
  assert(validDraconaSession(initial.session));assert.equal(initial.session.rulesVersion,3);
  if(seed===5){assert.equal(initial.session.returnedUnits,'1118');assert.equal(initial.wallet.balanceUnits,'201180000');}
  else {assert.equal(initial.session.state,'active');assert.equal(initial.wallet.balanceUnits,'190000000');}
  // A new runtime recovers the accepted history, including free spins and runes.
  games=new NileGameRuntime(c.ledger,max=>{draws++;return Math.floor(random()*max);});
  let reply=(await games.run(c.a,draconaCommand()))as any;
  let session=reply.sessions.find((s:any)=>s.id===start.id),last:unknown=start;
  while(session.state==='active'){
   last={id:randomUUID(),action:'move',gameId:'studio-dracona',sessionId:session.id,move:'dracona-spin',revision:session.view.dracona.revision};
   const beforeDraws:number=draws;await assert.rejects(games.run(c.a,command('/expansion',last)),/Обнови|refresh/);assert.equal(draws,beforeDraws);
   reply=await games.run(c.a,draconaCommand(last));session=reply.session;assert(validDraconaSession(session));
   if(session.state==='active')assert.equal(reply.wallet.balanceUnits,'190000000');
  }
  const expected=200000000n-10000000n+BigInt(session.returnedUnits)*10000n;
  assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(reply.wallet.reservedUnits,'0');
  const beforeDraws=draws,repeat=await games.run(c.a,draconaCommand(last))as any;
  assert.equal(repeat.replayed,true);assert.equal(repeat.wallet.balanceUnits,String(expected));assert.equal(draws,beforeDraws);
  assert.deepEqual(repeat.session,session);await c.ledger.audit();
 }finally{await c.close();}
});
test('slots and PvP spend the same Nile journal without importing or minting demo balances',async()=>{
 const c=await setup();try{
  const initial=await c.games.run(c.a,command('/'))as any;assert.equal(initial.balance,200);assert.equal(initial.asset,'USDT_NILE_TEST');
  await assert.rejects(c.games.run(c.a,command('/operations',{id:randomUUID(),kind:'deposit',amount:100000})),/Пополняй общий баланс/);
  const spin={id:randomUUID(),kind:'spin',amount:10},win=await c.games.run(c.a,command('/operations',spin))as any;
  assert.equal(win.wallet.balance,310);assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'310000000');
  const replay=await c.games.run(c.a,command('/operations',spin))as any;assert.equal(replay.wallet.balance,310);
  const matchId=randomUUID();await c.ledger.pvpHold(c.a,{matchId,gameId:'durak',stakeUnits:'50000000'});
  assert.equal((await c.games.run(c.a,command('/'))as any).balance,260);
  await c.ledger.pvpHold(c.b,{matchId,gameId:'durak',stakeUnits:'50000000'});
  await c.ledger.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'});
  assert.equal((await c.games.run(c.a,command('/'))as any).balance,355);
  assert.equal((await c.ledger.audit()).totalUnits,'1000400000000');
 }finally{await c.close();}
});
test('persistent Mines reserves house coverage and cannot reuse stakes after a PvP reservation',async()=>{
 const c=await setup();try{
  const start=await c.games.run(c.a,command('/mines',{id:randomUUID(),action:'start',amount:10,mineCount:1}))as any;
  assert.equal(start.wallet.balance,190);assert.equal(start.session.state,'active');
  await c.ledger.pvpHold(c.a,{matchId:randomUUID(),gameId:'pool',stakeUnits:'150000000'});
  await assert.rejects(c.games.run(c.a,command('/operations',{id:randomUUID(),kind:'spin',amount:50})),/Недостаточно/);
  const mine=await c.games.run(c.a,command('/mines',{id:randomUUID(),action:'reveal',sessionId:start.session.id,cell:0}))as any;
  assert.equal(mine.session.state,'lost');assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'40000000');
  assert.equal((await c.ledger.audit()).totalUnits,'1000400000000');
 }finally{await c.close();}
});
test('insufficient house coverage rejects before drawing and leaves no game projection changes',async()=>{
 const c=await pvpFixture();let draws=0;const games=new NileGameRuntime(c.ledger,()=>{draws++;return 0;});
 try{await assert.rejects(games.run(c.a,command('/operations',{id:randomUUID(),kind:'spin',amount:10})),/резерве казино/);
  assert.equal(draws,0);assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'200000000');assert.equal((await c.ledger.audit()).houseUnits,'0');
 }finally{await c.close();}
});

test('reopening the native wallet refunds untouched removed rounds or pays their saved cashout exactly once',async()=>{
 for(const choices of [[],[1]]){
  const c=await setup();try{
   const state=await seedNativeTower(c.ledger,c.a,savedTower(choices));
   assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'190000000');
   const restored=new NileGameRuntime(c.ledger,()=>{throw Error('Retirement must not draw new results');});
   const reply=await restored.run(c.a,command('/casino-sessions'))as any;
   const expected=choices.length?'203200000':'200000000';
   assert.deepEqual(reply.sessions,[]);assert.equal(reply.wallet.balanceUnits,expected);assert.equal(reply.wallet.reservedUnits,'0');
   const receipt=await c.ledger.db.prepare('SELECT * FROM removed_casino_settlements WHERE account_id=? AND session_id=?').get(c.a,state.id);
   assert.equal(receipt!.reason,choices.length?'cashout':'refund');assert.deepEqual(JSON.parse(receipt!.original_payload),state);
   assert.equal((await restored.run(c.a,command('/casino-sessions'))as any).wallet.balanceUnits,expected);
   assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,expected);await c.ledger.audit();
  }finally{await c.close();}
 }
});
test('a failed financial append rolls back game state, then retry settles once',async()=>{
 const c=await setup();try{
  await c.games.ready;
  await c.ledger.db.exec("CREATE FUNCTION reject_native_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='native' THEN RAISE EXCEPTION 'injected native failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_native BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_native_fn()");
  const op={id:randomUUID(),kind:'spin',amount:10};await assert.rejects(c.games.run(c.a,command('/operations',op)),/injected native failure/);
  assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'200000000');
  assert.equal(await c.ledger.db.prepare('SELECT 1 FROM demo_operations WHERE operation_id=?').get(op.id),undefined);
  await c.ledger.db.exec('DROP TRIGGER reject_native ON events');
  assert.equal((await c.games.run(c.a,command('/operations',op))as any).wallet.balance,310);
  assert.equal((await c.games.run(c.a,command('/operations',op))as any).wallet.balance,310);
  await c.ledger.audit();
 }finally{await c.close();}
});
test('fractional USDT from a duel survives cents-based slot operations exactly',async()=>{
 const c=await setup();try{
  const matchId=randomUUID();for(const id of[c.a,c.b])await c.ledger.pvpHold(id,{matchId,gameId:'durak',stakeUnits:'1010000'});
  await c.ledger.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'});
  const before=BigInt((await c.ledger.wallet(c.a)as any).balanceUnits),result=await c.games.run(c.a,command('/operations',{id:randomUUID(),kind:'spin',amount:10}))as any;
  assert.equal(result.wallet.balanceUnits,String(before+110000000n));
  assert.equal(BigInt(result.wallet.balanceUnits)%10000n,9000n);await c.ledger.audit();
 }finally{await c.close();}
});
test('old cosmetic progress imports once without importing a balance or resetting earned looks',async()=>{
 const c=await setup();try{
  const legacy={wardrobe:{version:4 as const,revision:7,selectedGirl:1,selectedLook:1 as const,albumUnits:90000,pointsUnits:[400000,100000,300000,200000],unlocked:[true,true,true,true],active:false,activeGirl:null},convoy:{version:1 as const,completedRounds:250}};
  const profile=await c.games.run(c.a,{...command('/afterglow-wardrobe'),legacy})as any;
  assert.equal(profile.selectedLook,1);assert.equal(profile.selectedGirl,1);assert.equal(profile.revision,7);
  assert.equal((await c.games.run(c.a,command('/convoy-progress'))as any).completedRounds,250);
  await c.games.run(c.a,{...command('/'),legacy:{...legacy,convoy:{version:1,completedRounds:0}}});
  assert.equal((await c.games.run(c.a,command('/convoy-progress'))as any).completedRounds,250);
  assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'200000000');await c.ledger.audit();
 }finally{await c.close();}
});

test('GirlHUB bonus credits Mia once and unlocks Naomi in the common wallet',async()=>{
 const c=await setup();try{
  let seed=5;const draw=(max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  const games=new NileGameRuntime(c.ledger,draw);await games.ready;
  const initial=await games.run(c.a,command('/afterglow-wardrobe'))as any;assert.equal(initial.selectedGirl,1);
  await c.ledger.db.prepare('INSERT INTO demo_afterglow_stake_album VALUES(?,15900)').run(c.a);
  let reply=await games.run(c.a,command('/expansion',{id:randomUUID(),action:'start',gameId:'studio-afterglow',stakeUnits:'100',settings:{afterglow:{mode:'normal'}},appearance:{girl:1,look:0,revision:0}}))as any;
  assert(validAfterSession(reply.session));assert.equal(reply.session.state,'active');assert.equal(reply.wallet.balanceUnits,'199000000');
  assert.equal((await games.run(c.a,command('/afterglow-wardrobe'))as any).albumUnits,15900);
  let last:unknown;
  while(reply.session.state==='active'){
   last={id:randomUUID(),action:'move',gameId:'studio-afterglow',sessionId:reply.session.id,move:'afterglow-spin',revision:reply.session.view.afterglow.revision};
   reply=await games.run(c.a,command('/expansion',last))as any;assert(validAfterSession(reply.session));
  }
  const balance=reply.wallet.balanceUnits;
  assert.equal((await games.run(c.a,command('/expansion',last))as any).wallet.balanceUnits,balance);
  const earned=await games.run(c.a,command('/afterglow-wardrobe'))as any;assert.equal(earned.albumUnits,16000);assert.deepEqual(earned.pointsUnits,[0,100,0,0]);
  const rare=await games.run(c.a,command('/afterglow-wardrobe',{girl:3,look:0,revision:earned.revision}))as any;assert.equal(rare.selectedGirl,3);
  await c.ledger.audit();
 }finally{await c.close();}
});
