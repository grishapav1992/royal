import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import express from 'express';
import {ExpansionClient} from '../src/wallet/ExpansionClient';
import {verifyGameRound} from '../server/games/core';
import {pvpFixture} from './finance/helpers/nile-pvp-fixture';
import {block} from './finance/helpers/nile-play-fixture';
import {createNilePlayServer} from '../server/finance/nile-play-service';
// @ts-ignore Checked shared runtime case matrix.
import {settingsFor} from '../scripts/game-math/stake-runtime.mjs';
process.env.AUTH_DB_PATH=':memory:';
const {accounts}=await import('../server/accounts');
const {installDemoWallet}=await import('../server/demoWalletRoutes');
const {installGameWallet}=await import('../server/gameWalletRoutes');
const policies=JSON.parse(readFileSync(new URL('../scripts/game-math/rtp-policy.json',import.meta.url),'utf8')).stakePolicies;
const capabilities={'X-Royal-Card-Rules':'2','X-Royal-Caramel-Rules':'1','X-Royal-Velvet-Rules':'1','X-Royal-Convoy-Rules':'1','X-Royal-Nitro-Rules':'1','X-Royal-Afterglow-Rules':'1','X-Royal-Afterglow-Progress':'4','X-Royal-Meme-Rules':'1','X-Royal-Cr-Leo':'1','X-Royal-Neopolis-Rules':'4','X-Royal-Dracona-Rules':'2','X-Royal-Flag-Battle':'2','X-Royal-Jackie':'2','X-Royal-Temple-Rules':'2','X-Royal-Forest-Heart-Rules':'1','X-Royal-Caribbean-Treasures':'1'};
const next=(s:any)=>{
 const v=s.view,name=v.forestHeart?.stage==='choice'?'forest-pass':v.caribbean?.phase==='choice'?'caribbean-choose-raid':v.actions.find((a:any)=>a.move==='cashout')?.move??v.actions.find((a:any)=>a.cost===0)?.move;
 assert(name);const revision=v.templeCascade?.revision??v.caribbean?.revision??v.forestHeart?.revision??v.neopolis?.revision??v.dracona?.revision??v.afterglow?.revision??v.nitro?.revision??v.convoy?.revision??v.caramel?.revision??v.luelon?.revision??v.penalty?.revision??v.jackie?.combat.revision;
 return{id:randomUUID(),gameId:s.gameId,action:'move',sessionId:s.id,move:name,...(revision===undefined?{}:{revision})};
};
test.after(async()=>{await accounts.close();});
for(const native of [false,true])test(`${native?'USDT financial socket':'common demo wallet'} accepts ten-cent total rounds in all 18 games and never duplicates money`,{timeout:240000},async()=>{
 const client=new ExpansionClient(2),verify=(s:any)=>Reflect.get(client,'checkedSession').call(client,s);
 for(const [game,p]of Object.entries(policies)as [string,any][]){
  const login=await accounts.login('shared-http-'+randomUUID()+'@example.test','Royal-shared-stakes-42!');
  const c=native?await pvpFixture([login.account.id,randomUUID()]):undefined;
  const socket=join(tmpdir(),'royal-stakes-'+randomUUID()+'.sock');let finance:ReturnType<typeof createNilePlayServer>|undefined;
  if(c){await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());finance=createNilePlayServer(c.ledger);await new Promise<void>(r=>finance!.listen(socket,r));}
  else await accounts.wallet.operate(login.account.id,{id:randomUUID(),kind:'deposit',amount:100000});
  const app=express();native?installGameWallet(app,socket):installDemoWallet(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');const url='http://127.0.0.1:'+address.port+'/api/'+(native?'game-wallet':'demo-wallet');
  const headers={...capabilities,Cookie:'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json'};
  const post=(path:string,op:any)=>fetch(url+path,{method:'POST',headers,body:JSON.stringify(op)});
  const balance=async()=>{const r=await fetch(url,{headers});assert.equal(r.status,200);return(await r.json()).balance;};
  try{
   const core=game==='royal-plinko'||game==='royal-roulette',path=core?'/operations':'/expansion';
   const op:any=core?{id:randomUUID(),kind:'play',gameId:game,rulesVersion:1,amount:.1,input:game==='royal-plinko'?{rows:8,risk:'easy'}:{bet:'number',number:7}}:{id:randomUUID(),gameId:game,action:'start',stakeUnits:'10',settings:settingsFor(game,p.choices[0])};
   const before=await balance();assert.equal((await post(path,op)).status,409,game+' cached client must refresh before a new debit');assert.equal(await balance(),before);
   if(game==='studio-caribbean-treasures'){const old=structuredClone(op);delete old.settings.caribbean.stakeBasis;assert.equal((await post(path,{...old,stakePolicyVersion:1})).status,400);assert.equal(await balance(),before);}
   if(game==='studio-flooded-temple'){const old={...op,settings:{temple:{mode:'normal'}},stakePolicyVersion:1};assert.equal((await post(path,old)).status,409);assert.equal(await balance(),before);}
   op.stakePolicyVersion=1;const response=await post(path,op);assert.equal(response.status,200,game+': '+await response.clone().text());let reply:any=await response.json(),last=op;
   if(core){assert(verifyGameRound(reply.gameRound));assert.equal(reply.gameRound.stakeUnits,'10');assert(reply.gameRound.precision);}
   else{
    assert(verify(reply.session));assert.equal(reply.session.stakeUnits,'10');assert.equal(reply.session.spentUnits,'10',game+' total normal spin price');
    let moves=0;while(reply.session.state==='active'){
     assert(moves++<10000);const saved=await balance();last=next(reply.session);const r=await post(path,last);
     if(game==='github-crash'&&r.status===409){
      const recovered=await(await fetch(url+'/expansion',{headers})).json();const ended=recovered.sessions.find((s:any)=>s.id===op.id);assert.equal(ended?.state,'settled');reply={wallet:recovered.wallet,session:ended};last=op;
     }else{assert.equal(r.status,200,game);reply=await r.json();}
     assert(verify(reply.session));if(reply.session.state==='active')assert.equal(await balance(),saved);
    }
    assert(reply.session.precision);
   }
   const paid=core?reply.gameRound.payoutUnits:reply.session.returnedUnits,expected=Math.round(before*100)-10+Number(paid);assert.equal(Math.round(reply.wallet.balance*100),expected);
   const repeat=await post(path,last);assert.equal(repeat.status,200);const saved:any=await repeat.json();assert.deepEqual(core?saved.gameRound:saved.session,core?reply.gameRound:reply.session);assert.equal(Math.round(saved.wallet.balance*100),expected);
   assert.equal(saved.wallet.entries.filter((e:any)=>e.kind==='bet'&&e.source===game).length,1);assert.equal(saved.wallet.entries.filter((e:any)=>e.kind==='win'&&e.source===game).length,1);
   if(c)await c.ledger.audit();
  }finally{await new Promise<void>(r=>server.close(()=>r()));if(finance)await new Promise<void>(r=>finance!.close(()=>r()));await c?.close();}
 }
});
