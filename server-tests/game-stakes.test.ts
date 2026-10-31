import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GAME_STAKE_CENTS, GAME_STAKE_UNITS, GAME_BETS, validGameStake, validGameBet, usesGameStakes} from '../src/shared/gameStakes';
import {prepareGame, verifyGameRound} from '../server/games/core';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore, WalletError} from '../server/demoWallet';

test('one exact denomination list starts at ten cents and rejects malformed money',()=>{
 assert.deepEqual(GAME_STAKE_CENTS,[10,20,50,100,200,500,1000,2000,5000]);
 for(let i=0;i<GAME_BETS.length;i++){
  assert.equal(String(GAME_BETS[i]*100),GAME_STAKE_UNITS[i]);
  assert(validGameStake(GAME_STAKE_UNITS[i]));assert(validGameBet(GAME_BETS[i]));
 }
 for(const v of [null,0,10,NaN,'0','1','9','10.0','010','1e1','10000'])assert(!validGameStake(v));
 for(const v of [null,'0.1',0,0.01,0.09,0.1000000001,NaN,Infinity,100])assert(!validGameBet(v));
 for(const id of ['royal-coins','royal-fruits','studio-wild-nudge','flag-tote','github-tower','not-a-game'])assert(!usesGameStakes(id));
});

test('roulette and plinko settle the minimum stake in integer cents',()=>{
 for(const stake of GAME_STAKE_CENTS){
  for(let number=0;number<37;number++){
   const game=prepareGame('royal-roulette',1,{bet:'number',number});
   const round=game.play(BigInt(stake),()=>number);
   assert(verifyGameRound(round));assert.equal(round.payoutUnits,String(stake*36));
  }
  for(const risk of ['easy','medium','hard','expert']){
   const game=prepareGame('royal-plinko',1,{rows:8,risk});
   const round=game.play(BigInt(stake),()=>0);assert(verifyGameRound(round));
   assert.equal(round.stakeUnits,String(stake));assert(Number.isSafeInteger(Number(round.payoutUnits)));
  }
 }
});

test('ten-cent operations survive retries and restart without a second debit',async()=>{
 const db=new PostgresDatabase(':memory:');let draws=0;
 try{
  await db.exec("CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('stake-user') ON CONFLICT DO NOTHING");
  let wallet=new DemoWalletStore(db,()=>{draws++;return 7;});
  await wallet.operate('stake-user',{id:randomUUID(),kind:'deposit',amount:10});
  const request={id:randomUUID(),kind:'play',gameId:'royal-roulette',rulesVersion:1,amount:0.1,input:{bet:'number',number:7}};
  const first=await wallet.operate('stake-user',request);assert.equal(first.wallet.balance,13.5);
  assert.equal(first.gameRound!.stakeUnits,'10');assert.equal(first.gameRound!.payoutUnits,'360');
  const row=await db.prepare('SELECT amount,amount_units FROM demo_operations WHERE operation_id=?').get(request.id);
  assert.equal(Number(row!.amount_units),10);
  wallet=new DemoWalletStore(db,()=>{throw Error('A replay cannot draw');});
  const second=await wallet.operate('stake-user',request);assert.deepEqual(second.gameRound,first.gameRound);assert.equal(second.wallet.balance,13.5);assert.equal(draws,1);
  await assert.rejects(wallet.operate('stake-user',{...request,amount:0.2}),e=>e instanceof WalletError&&e.status===409);
  await assert.rejects(wallet.operate('stake-user',{...request,id:randomUUID(),amount:0.01}),e=>e instanceof WalletError&&e.status===400);
  assert.equal((await wallet.snapshot('stake-user')).balance,13.5);
 }finally{await db.close();}
});

test('all line counts in the Caribbean total-stake contract cost ten cents',async()=>{
 const {startCaribbeanRound,moveCaribbeanRound,validCaribbeanView,caribbeanInitialCost}=await import('../src/shared/caribbeanTreasures');
 const {seededRandom}=await import('../src/shared/draconaMath');
 for(const lines of [1,5,10,20] as const){
  for(const stake of GAME_STAKE_UNITS){
   const settings={lines,mode:'normal' as const,stakeBasis:'total' as const};
   assert.equal(caribbeanInitialCost(settings,stake),stake);
   const random=seededRandom(971311),draw=(n:number)=>Math.floor(random()*n);
   let r=startCaribbeanRound(settings,stake,draw);
   while(!r.ended)r=moveCaribbeanRound(r.view,r.view.revision,r.view.phase==='choice'?'choose-raid':'spin',draw);
   assert.equal(r.view.version,2);assert(validCaribbeanView(r.view));assert.equal(r.costUnits,stake);
   assert(Number.isSafeInteger(Number(r.creditUnits)));
  }
  const legacy=startCaribbeanRound({lines,mode:'normal'},'100',()=>0);
  assert.equal(legacy.view.version,1);assert.equal(legacy.costUnits,String(lines*100));assert(validCaribbeanView(legacy.view));
 }
});

test('Dracona supports fractional dollar stakes without changing whole-dollar payouts',async()=>{
 const {clusterPayout,playSpin,seededRandom}=await import('../src/shared/draconaMath');
 for(const stake of GAME_BETS){
  const spin=playSpin({bet:stake,random:seededRandom(831117)});
  assert(Number.isSafeInteger(Math.round(spin.payout*100)));
  for(const symbol of [0,1,2,3,4,5] as const){
   const expected=BigInt(Math.round(stake*100))*25n*BigInt([13,12,11,10,9,8][symbol])*497300n/100000000n;
   assert.equal(Math.round(clusterPayout(symbol,5,stake,1)*100),Number(expected));
  }
 }
});

test('cascade payouts settle once in whole cents, including a fractional line stake',async()=>{
 const {cascadeUnits}=await import('../src/shared/floodedTempleCascade');
 assert.equal(cascadeUnits(1,'10'),'0');assert.equal(cascadeUnits(3,'10'),'1');assert.equal(cascadeUnits(4,'10'),'2');
 for(const stake of GAME_STAKE_UNITS)for(const points of [0,1,3,51,9999,10000]){
  assert.equal(cascadeUnits(points,stake),String(BigInt(points)*BigInt(stake)/20n));
 }
});

test('every production game accepts ten cents through the common wallet and completes without another wager',async t=>{
 const {DemoExpansionStore}=await import('../server/demoExpansion');
 const {seededRandom}=await import('../src/shared/draconaMath');
 const {demoBalanceUnits,demoReservedUnits}=await import('../server/demoWalletAmounts');
 const configurations:[string,unknown][]=[
  ['studio-cosmic-escape',{luelon:{mode:'normal'}}],['studio-velvet-reign',{luelon:{mode:'normal'}}],
  ['studio-caramel-carnival',{caramel:{mode:'normal'}}],['studio-last-convoy',{convoy:{mode:'normal'}}],
  ['studio-nitro-run',{nitro:{mode:'normal'}}],['studio-meme-overload',{nitro:{mode:'normal'}}],
  ['studio-afterglow',{afterglow:{mode:'normal'}}],['studio-dracona',{dracona:{mode:'normal'}}],
  ['studio-neopolis',{neopolis:{hero:'granite'}}],['studio-forest-heart',{forestHeart:{mode:'normal'}}],
  ['original-cr-vs-leo',{penalty:{hero:'cr',risk:'safe'}}],
  ['original-jackie-chan',{jackie:{risk:'safe',costume:'master',location:'restaurant'}}],
  ['studio-caribbean-treasures',{caribbean:{lines:20,mode:'normal',stakeBasis:'total'}}],
  ['studio-flooded-temple',{temple:{mode:'cascades'}}],['flag-battle',{flags:{country:'RU',mode:'classic'}}],
  ['github-crash',{}],
 ];
 const db=new PostgresDatabase(':memory:');
 try{
  await db.exec('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)');
  const wallet=new DemoWalletStore(db);await wallet.ready;
  const random=seededRandom(971179);let at=1000000;
  const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},max=>Math.floor(random()*max),()=>at);
  const operate=(user:string,op:unknown)=>store.operate(user,op,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,2);
  for(const [gameId,settings] of configurations)await t.test(gameId,async()=>{
   await db.prepare('INSERT INTO accounts(id) VALUES (?)').run(gameId);
   await wallet.operate(gameId,{id:randomUUID(),kind:'deposit',amount:1000});
   const op={id:randomUUID(),gameId,action:'start',stakeUnits:'10',settings};
   let reply=await operate(gameId,op);const id=reply.session.id;
   assert.equal(reply.session.stakeUnits,'10',gameId);assert.equal(reply.session.spentUnits,'10',gameId);
   const retry=await operate(gameId,op);assert(retry.replayed,gameId);
   assert.equal(retry.wallet.balance,reply.wallet.balance,gameId);
   let moves=0;
   while(reply.session.state==='active'){
    assert(moves++<100,gameId+' must have a finite round');
    const s=reply.session;
    const action=s.view.actions.find(a=>a.move==='cashout'||a.move==='forest-pass')??s.view.actions.find(a=>a.cost===0);
    assert(action,gameId+' must have a free continuation');at+=100000;
    const v=s.view;
    const revision=v.templeCascade?.revision??v.caribbean?.revision??v.forestHeart?.revision??v.neopolis?.revision??v.dracona?.revision??v.afterglow?.revision??v.nitro?.revision??v.convoy?.revision??v.caramel?.revision??v.luelon?.revision??v.penalty?.revision??v.jackie?.combat.revision;
    reply=await operate(gameId,{id:randomUUID(),gameId,action:'move',sessionId:id,move:action.move,...(revision===undefined?{}:{revision})});
   }
   assert.equal(reply.session.spentUnits,'10',gameId);
   assert.equal(await demoBalanceUnits(db,gameId),100000-10+Number(reply.session.returnedUnits),gameId);
   assert.equal(await demoReservedUnits(db,gameId),0,gameId);
   assert(Number.isSafeInteger(Number(reply.session.returnedUnits)),gameId);
   await assert.rejects(operate(gameId,{...op,id:randomUUID(),stakeUnits:'9'}),undefined,gameId);
  });
 }finally{await db.close();}
});
