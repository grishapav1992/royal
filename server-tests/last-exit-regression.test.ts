import test from 'node:test';import assert from 'node:assert/strict';
import {raceDisplay,raceHundredths} from '../src/ui/lastExitModel';
import type {ExpansionSession} from '../src/shared/casinoExpansion';
import {ExpansionClient} from '../src/wallet/ExpansionClient';
import {demoWallet} from '../src/wallet/WalletClient';
const id='b02e419e-5cab-4f07-86b3-0560875cc7c5';
const active:ExpansionSession={id,gameId:'github-crash',rulesVersion:1,state:'active',stakeUnits:'1000',spentUnits:'1000',returnedUnits:'0',startedAt:100000,serverNow:103000,multiplier:Math.exp(.18),view:{player:[],dealer:[],community:[],actions:[{move:'cashout',label:'Exit',cost:0}],phase:1,ended:false,message:''}};
test('live HUD and exit amount use the same floored hundredths',()=>{const d=raceDisplay(active,{id,from:103000,to:103000,at:500,heardAt:500},500,true);assert.equal(d.hundredths,119);assert.equal((d.hundredths/100).toFixed(2),'1.19');assert.equal(BigInt(active.stakeUnits)*BigInt(d.hundredths)/100n,1190n);for(const value of [1,1.005,1.0099,1.1972173631218102,2,99.999,100]){const cents=raceHundredths(value);assert.equal(cents,Math.floor(value*100));assert(cents/100<=value);}});
test('confirmed paid fractional multipliers are not floored a second time',()=>{for(const value of [1.13,1.14,1.15,1.16,2.01,99.99,100]){const s={...active,state:'settled' as const,returnedUnits:'1150',multiplier:value};const d=raceDisplay(s,undefined,0);assert.equal((d.hundredths/100).toFixed(2),value.toFixed(2));assert.equal(raceHundredths(value,true),Math.round(value*100));}assert.equal(raceHundredths(1.1972173631218102,false),119);});
test('cashout invalidates an in-flight GET; late active reply cannot restore it or its balance',async()=>{
 const fetchBefore=globalThis.fetch,storageBefore=globalThis.sessionStorage;
 const memory=new Map<string,string>();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
 let releaseRead!:(value:Response)=>void,releasePost!:(value:Response)=>void,posts=0;
 const readResponse=new Promise<Response>(r=>releaseRead=r),postResponse=new Promise<Response>(r=>releasePost=r);
 globalThis.fetch=(async(_input,init)=>{if(init?.method==='POST'){posts++;return postResponse;}return readResponse;}) as typeof fetch;
 const client=new ExpansionClient();client.accountId='local-regression';
 try{
  const reading=client.refresh();assert.equal(client.loading,true);
  const writing=client.act({gameId:'github-crash',action:'move',sessionId:id,move:'cashout'});assert.equal(posts,1);assert.equal(client.busy,true);assert.equal(client.loading,false);
  await assert.rejects(client.act({gameId:'github-crash',action:'move',sessionId:id,move:'cashout'}));assert.equal(posts,1);
  const settled={...active,state:'settled',returnedUnits:'1190',multiplier:1.19,view:{...active.view,actions:[],ended:true}};
  releasePost(Response.json({wallet:{balance:10001.9,entries:[]},sessions:[settled],session:settled,replayed:false}));await writing;
  assert.equal(client.sessions[0].state,'settled');assert.equal(client.wallet?.balance,10001.9);assert.equal(client.pending,undefined);
  releaseRead(Response.json({wallet:{balance:9990,entries:[]},sessions:[active]}));await reading;
  assert.equal(client.sessions[0].state,'settled');assert.equal(client.wallet?.balance,10001.9);assert.equal(client.error,'');assert.equal(posts,1);
 }finally{globalThis.fetch=fetchBefore;Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storageBefore});demoWallet.setExternalBusy('expansion',false);}
});
