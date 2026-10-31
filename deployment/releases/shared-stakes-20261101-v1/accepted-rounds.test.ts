import test from'node:test';import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{randomUUID,createHash}from'node:crypto';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{pvpFixture}from'../../../server-tests/finance/helpers/nile-pvp-fixture';import{block}from'../../../server-tests/finance/helpers/nile-play-fixture';import{seededRandom}from'../../../src/shared/draconaMath';import{ExpansionClient}from'../../../src/wallet/ExpansionClient';import{verifyGameRound}from'../../../server/games/core';
// @ts-ignore Checked paid-round case matrix.
import{settingsFor}from'../../../scripts/game-math/stake-runtime.mjs';
const root=process.cwd(),folder='deployment/releases/shared-stakes-20261101-v1';
// @ts-ignore This is the reviewed, compiled projection verifier.
const{verifyNativeBuild}=await import('./native-build.mjs');
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
test('actual production rounds resume and replay unchanged through the projected USDT release, then accept a ten-cent total round',{timeout:360000},async()=>{
 const realNow=Date.now;let clock=realNow(),index=0,continuations=0,legacyBonuses=0;const digest=createHash('sha256'),rows:any[]=[],client=new ExpansionClient(2),verify=(s:any)=>Reflect.get(client,'checkedSession').call(client,s);
 const cases=Object.entries(policies).map(([game,p]:any)=>({game,choice:p.choices[0]}));cases.push({game:'studio-caramel-carnival',choice:'festival'},{game:'studio-velvet-reign',choice:'super-encore'},{game:'studio-cosmic-escape',choice:'cosmic-chaos'},{game:'studio-caribbean-treasures',choice:'lines-20-buy-raid'},{game:'studio-flooded-temple',choice:'legacy-map'});
 Date.now=()=>clock;
 try{for(const{game,choice}of cases){console.log('legacy round',game,choice);
  const a=await pvpFixture(),b=await pvpFixture(),seed=513731+index++*7919,r1=seededRandom(seed),r2=seededRandom(seed),drawA=(n:number)=>Math.floor(r1()*n),drawB=(n:number)=>Math.floor(r2()*n);
  try{
   for(const c of[a,b]){await c.source.ingest(block(102,'100000000000000',c.config.source.addresses.find(x=>x.userId==='reserve')!.address));await c.source.ingest(block(103,'1000000000000',c.config.source.addresses.find(x=>x.userId==='player')!.address));await c.ledger.sync(c.source,await c.reconciliation());}
   let candidate=new Old(a.ledger,drawA),reference=new Old(b.ledger,drawB);if(game==='github-crash'){Reflect.set(Reflect.get(candidate,'store').expansion,'crashRoll',()=>1.5);Reflect.set(Reflect.get(reference,'store').expansion,'crashRoll',()=>1.5);}const core=game==='royal-plinko'||game==='royal-roulette',map=choice==='legacy-map';
   const command=(body:any=null):any=>({path:core?(body?'/operations':'/'):'/expansion',body,method:body?'POST':'GET',flags:[true,true,true,true,true,true,true,true,2],rules:2,query:{},neopolisRules:4,caribbeanRules:1,forestHeartRules:1,flagRules:2,jackieRules:2,templeRules:map?1:2});
   const settings=map?{temple:{mode:'normal'}}:settingsFor(game,choice);if(settings.caribbean)delete settings.caribbean.stakeBasis;
   const start:any=core?{id:randomUUID(),kind:'play',gameId:game,rulesVersion:1,amount:10,input:game==='royal-plinko'?{rows:12,risk:'hard'}:{bet:'red'}}:{id:randomUUID(),gameId:game,action:'start',stakeUnits:'1000',settings};
   let actual:any=await candidate.run(a.a,command(start)),expected:any=await reference.run(b.a,command(start));assert.deepEqual(stable(actual.session??actual.gameRound),stable(expected.session??expected.gameRound));assert.equal(actual.wallet.balanceUnits,expected.wallet.balanceUnits);
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
   if(game==='studio-afterglow'){const wardrobe:any=await candidate.run(a.a,{...command(),path:'/afterglow-wardrobe'});assert.equal(wardrobe.version,3,'Published wardrobe must stay at version 3');}
   await a.ledger.audit();await b.ledger.audit();const row={game,choice,legacyUnchanged:true,moves,freshMinimumUnits:'10',freshCreditedUnits:core?current.gameRound.payoutUnits:current.session.returnedUnits,journalBalanced:true};rows.push(row);digest.update(JSON.stringify(row)+'\n');
  }finally{await a.close();await b.close();}
 }
 const report={passed:true,productionSource:oldProof.productionCommit,oldRuntimeSha256:oldProof.outputs['runtime.mjs'].sha256,newRuntimeSha256:newProof.outputs['runtime.mjs'].sha256,legacyCases:rows.length,legacyBonuses,continuations,preservedWardrobeVersion:3,sha256:digest.digest('hex'),cases:rows};assert(rows.length===23&&legacyBonuses>=4);writeFileSync(process.env.ROYAL_STAKE_TEST_REPORT!,JSON.stringify(report,null,2)+'\n');
 }finally{Date.now=realNow;}
});
