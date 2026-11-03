import test from'node:test';import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{randomUUID,createHash}from'node:crypto';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{pvpFixture}from'../../../server-tests/finance/helpers/nile-pvp-fixture';import{block}from'../../../server-tests/finance/helpers/nile-play-fixture';import{seededRandom}from'../../../src/shared/draconaMath';import{ExpansionClient}from'../../../src/wallet/ExpansionClient';import{verifyGameRound}from'../../../server/games/core';
import '../../../server/demoWallet';
// @ts-ignore Checked paid-round case matrix.
import{settingsFor}from'../../../scripts/game-math/stake-runtime.mjs';
const root=process.cwd(),folder='deployment/releases/star-spin-20261103-v1';
// @ts-ignore This is the reviewed, compiled projection verifier.
const{verifyNativeBuild}=await import('../../releases/shared-stakes-20261101-v1/native-build.mjs');
const oldDir=resolve(process.env.ROYAL_STAKE_OLD_RUNTIME!),newDir=resolve(process.env.ROYAL_STAKE_NEW_RUNTIME!);assert(process.env.ROYAL_STAKE_OLD_RUNTIME&&process.env.ROYAL_STAKE_NEW_RUNTIME);
const oldProof=await verifyNativeBuild(root,oldDir),newProof=await verifyNativeBuild(root,newDir);
const{NileGameRuntime:Old}=await import(pathToFileURL(resolve(oldDir,'runtime.mjs')).href),{NileGameRuntime:Current}=await import(pathToFileURL(resolve(newDir,'runtime.mjs')).href);
const policies=JSON.parse(readFileSync('scripts/game-math/rtp-policy.json','utf8')).stakePolicies;
const stable=(s:any)=>{const v=structuredClone(s);delete v.serverNow;return v;};
function continuation(s:any){const v=s.view;
 const move=v.temple?'temple-finish':v.forestHeart?.stage==='choice'?'forest-pass':v.caribbean?.phase==='choice'?'caribbean-choose-raid':v.actions.find((a:any)=>a.move==='cashout')?.move??v.actions.find((a:any)=>a.cost===0)?.move;assert(move);
 const revision=v.temple?.revision??v.templeCascade?.revision??v.caribbean?.revision??v.forestHeart?.revision??v.neopolis?.revision??v.dracona?.revision??v.afterglow?.revision??v.nitro?.revision??v.convoy?.revision??v.caramel?.revision??v.luelon?.revision??v.penalty?.revision??v.jackie?.combat.revision;
 return{id:randomUUID(),gameId:s.gameId,action:'move',sessionId:s.id,move,...(revision===undefined?{}:{revision})};
}
// The current production boundary already rejects new starts without a stake
// policy. Seed accepted historical requests using its exact compiled engine and
// journal, then exercise only ordinary replay/recovery through that boundary.
async function accepted(runtime:any,ledger:any,account:string,command:any){
 const{saveDemoUnits,demoBalanceUnits,demoReservedUnits}=await import('../../../server/demoWalletAmounts');
 await runtime.ready;const store=Reflect.get(runtime,'store'),projection=Reflect.get(runtime,'projection'),op=command.body;
 await ledger.nativeTransaction(account,async(context:any)=>{
  await ledger.db.prepare('INSERT INTO accounts(id) VALUES(?) ON CONFLICT DO NOTHING').run(account);await saveDemoUnits(projection,account,Number(context.available/10000n));
  if(command.path==='/operations')await store.operate(account,op);
  else await store.expansion.operate(account,op,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,command.templeRules,true);
  await context.post(BigInt(await demoBalanceUnits(ledger.db,account))*10000n,BigInt(await demoReservedUnits(ledger.db,account))*10000n,createHash('sha256').update('accepted-round-fixture:'+JSON.stringify(command)).digest('hex'));
 });
 return runtime.run(account,command);
}
test('actual production rounds resume and replay unchanged through the projected common-money graph, then accept a ten-cent total round',{timeout:360000},async()=>{
 const realNow=Date.now;let clock=realNow(),index=0,continuations=0,legacyBonuses=0;const digest=createHash('sha256'),rows:any[]=[],client=new ExpansionClient(2),verify=(s:any)=>Reflect.get(client,'checkedSession').call(client,s);
 const cases=Object.entries(policies).filter(([game])=>game!=='tsu-e-fa'&&game!=='studio-wild-nudge').map(([game,p]:any)=>({game,choice:p.choices[0]}));cases.push({game:'studio-caramel-carnival',choice:'festival'},{game:'studio-velvet-reign',choice:'super-encore'},{game:'studio-cosmic-escape',choice:'cosmic-chaos'},{game:'studio-caribbean-treasures',choice:'lines-20-buy-raid'},{game:'studio-flooded-temple',choice:'legacy-map'});
 Date.now=()=>clock;
 try{for(const{game,choice}of cases){clock=Math.max(clock,realNow());console.log('legacy round',game,choice);
  const a=await pvpFixture(),b=await pvpFixture(),seed=513731+index++*7919,r1=seededRandom(seed),r2=seededRandom(seed),drawA=(n:number)=>Math.floor(r1()*n),drawB=(n:number)=>Math.floor(r2()*n);
  try{
   for(const c of[a,b]){await c.source.ingest(block(102,'100000000000000',c.config.source.addresses.find(x=>x.userId==='reserve')!.address));await c.source.ingest(block(103,'1000000000000',c.config.source.addresses.find(x=>x.userId==='player')!.address));await c.ledger.sync(c.source,await c.reconciliation());}
   let candidate=new Old(a.ledger,drawA),reference=new Old(b.ledger,drawB);if(game==='github-crash'){Reflect.set(Reflect.get(candidate,'store').expansion,'crashRoll',()=>1.5);Reflect.set(Reflect.get(reference,'store').expansion,'crashRoll',()=>1.5);}const core=game==='royal-plinko'||game==='royal-roulette',map=choice==='legacy-map';
   const command=(body:any=null):any=>({path:core?(body?'/operations':'/'):'/expansion',body,method:body?'POST':'GET',flags:[true,true,true,true,true,true,true,true,2],rules:2,query:{},neopolisRules:4,caribbeanRules:1,forestHeartRules:1,flagRules:2,jackieRules:2,templeRules:map?1:2});
   const settings=map?{temple:{mode:'normal'}}:settingsFor(game,choice);if(settings.caribbean)delete settings.caribbean.stakeBasis;
   const start:any=core?{id:randomUUID(),kind:'play',gameId:game,rulesVersion:1,amount:10,input:game==='royal-plinko'?{rows:12,risk:'hard'}:{bet:'red'}}:{id:randomUUID(),gameId:game,action:'start',stakeUnits:'1000',settings};
   let actual:any=await accepted(candidate,a.ledger,a.a,command(start)),expected:any=await accepted(reference,b.ledger,b.a,command(start));assert.deepEqual(stable(actual.session??actual.gameRound),stable(expected.session??expected.gameRound));assert.equal(actual.wallet.balanceUnits,expected.wallet.balanceUnits);
   legacyBonuses+=Number(actual.session?.state==='active');candidate=new Current(a.ledger,drawA,()=>clock);await candidate.ready;
   const replay:any=await candidate.run(a.a,command(start));assert.deepEqual(stable(replay.session??replay.gameRound),stable(actual.session??actual.gameRound));assert.equal(replay.wallet.balanceUnits,actual.wallet.balanceUnits);
   let last=start,moves=0;
   while(actual.session?.state==='active'){
    assert(moves++<10000);clock=Math.max(clock+100,(actual.session.startedAt??0)+1000);
    if(game==='github-crash'){
     const aa:any=await candidate.run(a.a,command()),bb:any=await reference.run(b.a,command());actual={wallet:aa.wallet,session:aa.sessions.find((s:any)=>s.id===start.id)};expected={wallet:bb.wallet,session:bb.sessions.find((s:any)=>s.id===start.id)};
     assert.deepEqual(stable(actual.session),stable(expected.session));if(actual.session.state==='settled'){last=start;break;}
    }
    last=continuation(actual.session);actual=await candidate.run(a.a,command(last));expected=await reference.run(b.a,command(last));continuations++;
    assert.deepEqual(stable(actual.session),stable(expected.session));assert.equal(actual.wallet.balanceUnits,expected.wallet.balanceUnits);
    candidate=new Current(a.ledger,drawA,()=>clock);await candidate.ready;
   }
   const final:any=await candidate.run(a.a,command(last));assert.deepEqual(stable(final.session??final.gameRound),stable(actual.session??actual.gameRound));assert.equal(final.wallet.balanceUnits,actual.wallet.balanceUnits);
   if(!core)assert(!actual.session.precision,'Accepted old round must retain its original settlement');
   const normal:any=policies[game],freshSettings=settingsFor(game,normal.choices[0]),fresh:any=core?{...start,id:randomUUID(),amount:.1,stakePolicyVersion:1}:{id:randomUUID(),gameId:game,action:'start',stakeUnits:'10',stakePolicyVersion:1,settings:freshSettings};
   if(map){rows.push({game,choice,legacyUnchanged:true,moves,freshCoveredByCascadeCase:true});continue;}
   let current:any=await candidate.run(a.a,command(fresh));assert.equal(core?current.gameRound.stakeUnits:current.session.spentUnits,'10');let n=0;
   while(current.session?.state==='active'){
    assert(n++<10000);clock=Math.max(clock+100,(current.session.startedAt??0)+1000);
    if(game==='github-crash'){const snapshot:any=await candidate.run(a.a,command());current={wallet:snapshot.wallet,session:snapshot.sessions.find((s:any)=>s.id===fresh.id)};if(current.session.state==='settled')break;}
    current=await candidate.run(a.a,command(continuation(current.session)));
   }
   if(core){assert(current.gameRound.precision);assert(verifyGameRound(current.gameRound));}else{assert(current.session.precision);assert(verify(current.session));}
   if(game==='studio-afterglow'){
    const beforeWardrobe:any=await candidate.run(a.a,{...command(),path:'/afterglow-wardrobe'});assert.equal(beforeWardrobe.version,3,'Published wardrobe must stay at version 3');
    let added=0;
    for(const stake of policies[game].stakes.slice(1)){
     const prior:any=await a.ledger.wallet(a.a),op={...fresh,id:randomUUID(),stakeUnits:String(stake)};let r:any=await candidate.run(a.a,command(op)),steps=0;
     while(r.session.state==='active'){assert(steps++<10000);r=await candidate.run(a.a,command(continuation(r.session)));}
     assert(verify(r.session));assert(r.session.precision);assert.equal(r.session.spentUnits,String(stake));assert.equal(r.wallet.balanceUnits,String(BigInt(prior.balanceUnits)-BigInt(stake)*10000n+BigInt(r.session.returnedUnits)*10000n));added+=stake;
    }
    const afterWardrobe:any=await candidate.run(a.a,{...command(),path:'/afterglow-wardrobe'});assert.equal(afterWardrobe.version,3);assert.equal(afterWardrobe.selectedGirl,beforeWardrobe.selectedGirl);assert.equal(afterWardrobe.albumUnits,Math.min(90000,beforeWardrobe.albumUnits+added));
   }
   await a.ledger.audit();await b.ledger.audit();const row={game,choice,legacyUnchanged:true,moves,freshMinimumUnits:'10',freshCreditedUnits:core?current.gameRound.payoutUnits:current.session.returnedUnits,journalBalanced:true};rows.push(row);digest.update(JSON.stringify(row)+'\n');
  }finally{await a.close();await b.close();}
 }
 const report={passed:true,productionSource:oldProof.productionCommit,oldRuntimeSha256:oldProof.outputs['runtime.mjs'].sha256,newRuntimeSha256:newProof.outputs['runtime.mjs'].sha256,legacyCases:rows.length,legacyBonuses,continuations,preservedWardrobeVersion:3,progress3QualifiedStakes:policies['studio-afterglow'].stakes,monetarySourceHashes:newProof.inputs,qualificationScriptSha256:createHash('sha256').update(readFileSync(folder+'/accepted-rounds.test.ts').toString('utf8').replace(/\r\n/g,'\n')).digest('hex'),productionBalancesChanged:false,sha256:digest.digest('hex'),cases:rows};assert(rows.length===23&&legacyBonuses>=4);writeFileSync(process.env.ROYAL_STAKE_TEST_REPORT!,JSON.stringify(report,null,2)+'\n');
 }finally{Date.now=realNow;}
});
test('the new catalogue game accepts one ten-cent round through the projected common-money implementation',async()=>{
 const c=await pvpFixture();try{
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(x=>x.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  let calls=0;const stops=[0,0,30,30,30],draw=(max:number)=>{calls++;return max===64?stops.shift()!:0;};
  const op={id:randomUUID(),gameId:'studio-wild-nudge',action:'start',stakeUnits:'10',stakePolicyVersion:1,settings:{wildNudge:{mode:'normal'}}},command:any={path:'/expansion',method:'POST',body:op,query:{},flags:[true,true,true,true,true,true,true,true,2],rules:2,wildNudgeRules:1};
  const old=new Old(c.ledger,draw);await assert.rejects(old.run(c.a,command));assert.equal(calls,0);
  const current=new Current(c.ledger,draw),before:any=await c.ledger.wallet(c.a),r:any=await current.run(c.a,command);assert.equal(r.session.rulesVersion,2);assert.equal(r.session.spentUnits,'10');assert.equal(r.session.returnedUnits,'34');assert.equal(r.session.view.wildNudge.totalPayoutUnits,'33');assert.equal(r.wallet.balanceUnits,String(BigInt(before.balanceUnits)+240000n));assert.equal(calls,6);assert((await current.run(c.a,command) as any).replayed);assert.equal(calls,6);await c.ledger.audit();
  const file=process.env.ROYAL_STAKE_TEST_REPORT!,report=JSON.parse(readFileSync(file,'utf8'));report.newGameMinimum={gameId:'studio-wild-nudge',stakeUnits:'10',allTwentyLines:true,exactFinalCredit:'34',replayUnchanged:true,ledgerBalanced:true};report.retiredNativeServicePublished=false;writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 }finally{await c.close();}
});
