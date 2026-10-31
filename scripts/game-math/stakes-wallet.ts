import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PostgresDatabase} from '../../server/database';
import {DemoWalletStore} from '../../server/demoWallet';
import {DemoExpansionStore} from '../../server/demoExpansion';
import {demoBalanceUnits,demoReservedUnits} from '../../server/demoWalletAmounts';
import {ExpansionClient} from '../../src/wallet/ExpansionClient';
import {forestHeartBestRotation} from '../../src/shared/forestHeartMath';
import {seededRandom} from '../../src/shared/draconaMath';
// The qualification driver and this child share case names, not wallet accounting.
// @ts-expect-error The runtime case matrix is a checked JavaScript qualification module.
import {settingsFor} from './stake-runtime.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
function nextAction(s:any,choice:string){
 const v=s.view;let name=v.actions.find((a:any)=>a.move==='cashout')?.move;
 if(v.forestHeart?.stage==='choice'){
  const rotation=choice==='optimal'?forestHeartBestRotation(v.forestHeart.base.bits).rotation:choice.startsWith('rotate-')?Number(choice.slice(7)):null;
  name=rotation===null?'forest-pass':'forest-turn-'+rotation;
 }
 if(v.caribbean?.phase==='choice')name=choice.endsWith('-flagship')?'caribbean-choose-flagship':'caribbean-choose-raid';
 const action=name??v.actions.find((a:any)=>a.cost===0)?.move;assert(action,'A continuation cannot create another paid stake');
 const revision=v.templeCascade?.revision??v.caribbean?.revision??v.forestHeart?.revision??v.neopolis?.revision??v.dracona?.revision??v.afterglow?.revision??v.nitro?.revision??v.convoy?.revision??v.caramel?.revision??v.luelon?.revision??v.penalty?.revision??v.jackie?.combat.revision;
 return {id:randomUUID(),gameId:s.gameId,action:'move',sessionId:s.id,move:action,...(revision===undefined?{}:{revision})};
}
async function nativeProof(gameId:string,p:any){
 const {pvpFixture}=await import('../../server-tests/finance/helpers/nile-pvp-fixture');
 const {block}=await import('../../server-tests/finance/helpers/nile-play-fixture');
 const {NileGameRuntime}=await import('../../server/finance/nile-game-runtime');
 const c=await pvpFixture();let time=1000000,calls=0;
 try{
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  const random=seededRandom(p.seeds[1]),draw=(max:number)=>{calls++;return Math.floor(random()*max);};
  const games=new NileGameRuntime(c.ledger,draw,()=>time),choice=p.choices[0];
  const core=gameId==='royal-roulette'||gameId==='royal-plinko',parts=choice.split(':');
  const op=core?{id:randomUUID(),kind:'play',gameId,rulesVersion:1,amount:.1,stakePolicyVersion:1,input:gameId==='royal-plinko'?{rows:Number(parts[0]),risk:parts[1]}:{bet:'number',number:7}}:{id:randomUUID(),action:'start',gameId,stakeUnits:'10',stakePolicyVersion:1,settings:settingsFor(gameId,choice)};
  const command=(body:unknown=null):any=>({path:core?'/operations':'/expansion',body,method:body===null?'GET':'POST',flags:[true,true,true,true,true,true,true,true,2],rules:2,query:{},neopolisRules:4,caribbeanRules:1,forestHeartRules:1,flagRules:2,jackieRules:2,templeRules:2});
  const before=BigInt((await c.ledger.wallet(c.a)as any).balanceUnits);let reply:any=await games.run(c.a,command(op));
  while(!core&&reply.session.state==='active'){
   if(gameId==='github-crash'){time+=100000;const snapshot:any=await games.run(c.a,command());reply={wallet:snapshot.wallet,session:snapshot.sessions.find((s:any)=>s.id===op.id)};}
   else reply=await games.run(c.a,command(nextAction(reply.session,choice)));
  }
  const paid=BigInt(core?reply.gameRound.payoutUnits:reply.session.returnedUnits),expected=before-100000n+paid*10000n;
  assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(reply.wallet.reservedUnits,'0');const count=calls,retry:any=await games.run(c.a,command(op));
  if(!core)assert(retry.replayed);assert.equal(retry.wallet.balanceUnits,String(expected));assert.equal(calls,count);await c.ledger.audit();
  return {passed:true,minimumStakeUnits:'10',replayPreserved:true,reservationReleased:true,journalBalanced:true};
 }finally{await c.close();}
}
async function runWallet(gameId:string,p:any){
 const db=new PostgresDatabase(':memory:'),digest=createHash('sha256'),rows:any[]=[];let clock=1000000,draws=0;
 const random=seededRandom(p.seeds[0]),draw=(max:number)=>{draws++;return Math.floor(random()*max);};
 const client=new ExpansionClient(2),verify=(s:any)=>Reflect.get(client,'checkedSession').call(client,s);
 try{
  await db.exec('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)');
  let wallet=new DemoWalletStore(db,draw,()=>clock);await wallet.ready;
  const create=()=>new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},draw,()=>clock,undefined,()=>2);
  let store=create();await store.ready;
  const operate=(account:string,op:unknown)=>store.operate(account,op,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,2);
  let index=0;
  for(const choice of p.choices)for(const stake of p.stakes){
   const account='precision-'+index++;await db.prepare('INSERT INTO accounts(id) VALUES(?)').run(account);
   await wallet.operate(account,{id:randomUUID(),kind:'deposit',amount:100000});
   const before=await demoBalanceUnits(db,account),id=randomUUID();let last:any;
   if(gameId==='royal-plinko'||gameId==='royal-roulette'){
    const [rowCount,risk]=choice.split(':'),input=gameId==='royal-plinko'?{rows:Number(rowCount),risk}:{bet:'number',number:7};
    const op={id,kind:'play',gameId,rulesVersion:1,amount:stake/100,stakePolicyVersion:1,input};
    const first=await wallet.operate(account,op);assert(first.gameRound?.precision);
    const count=draws;wallet=new DemoWalletStore(db,draw,()=>clock);await wallet.ready;
    const retry=await wallet.operate(account,op);assert.equal(draws,count);assert.deepEqual(retry.gameRound,first.gameRound);
    const paid=Number(first.gameRound.payoutUnits);assert.equal(await demoBalanceUnits(db,account),before-stake+paid);
    const wins=await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type='win'").get(account,id);assert.equal(Number(wins!.n),1);
    await assert.rejects(wallet.operate(account,{...op,amount:stake/100+.01}));
    const record={choice,stakeUnits:stake,spentUnits:stake,returnedUnits:paid,replayed:true,winEntries:1};digest.update(JSON.stringify(record)+'\n');rows.push(record);continue;
   }
   const op={id,gameId,action:'start',stakeUnits:String(stake),stakePolicyVersion:1,settings:settingsFor(gameId,choice)};
   let reply=await operate(account,op);assert(verify(reply.session),'Real client verification of accepted start');assert.equal(reply.session.stakeUnits,String(stake));last=op;
   const count=draws,repeated=await operate(account,op);assert.equal(draws,count);assert(repeated.replayed);assert.equal(repeated.wallet.balance,reply.wallet.balance);
   store=create();await store.ready;const recovered=await store.active(account,true,true,true,true,true,true,true,2,4,true,true,2,2,2);assert.deepEqual(recovered.sessions.find(s=>s.id===id),reply.session);
   let continuations=0;
   while(reply.session.state==='active'){
    assert(continuations++<10000);const prior=await demoBalanceUnits(db,account);assert(!reply.session.precision,'No future precision ticket may be exposed');
    last=nextAction(reply.session,choice);clock=gameId==='github-crash'?reply.session.startedAt!+1000:clock+100;
    reply=await operate(account,last);assert(verify(reply.session),'Real client verification of paid-round continuation');
    if(reply.session.state==='active')assert.equal(await demoBalanceUnits(db,account),prior,'Every bonus continuation is free');
   }
   assert(reply.session.precision);const spent=Number(reply.session.spentUnits),paid=Number(reply.session.returnedUnits);
   assert.equal(await demoBalanceUnits(db,account),before-spent+paid);assert.equal(await demoReservedUnits(db,account),0);
   const countAfter=draws;const finalReplay=await operate(account,last);assert.equal(draws,countAfter);assert(finalReplay.replayed);assert.deepEqual(finalReplay.session,reply.session);
   const entries=await db.prepare("SELECT entry_type,count(*) AS n FROM demo_ledger WHERE account_id=? AND operation_id IN (SELECT id FROM demo_casino_requests WHERE account_id=? AND session_id=?) GROUP BY entry_type").all(account,account,id);
   assert.equal(Number(entries.find(e=>e.entry_type==='bet')!.n),1);assert.equal(Number(entries.find(e=>e.entry_type==='win')!.n),1);
   const record={choice,stakeUnits:stake,spentUnits:spent,returnedUnits:paid,continuations,replayed:true,reopened:true,winEntries:1};digest.update(JSON.stringify(record)+'\n');rows.push(record);
  }
  const native=await nativeProof(gameId,p);
  return {passed:true,native,gameId,cases:rows.length,freeContinuationChecks:rows.reduce((n,r)=>n+(r.continuations??0),0),replayAndRestartCases:rows.length,oneDebitAndCredit:true,clientVerified:true,sha256:digest.digest('hex')};
 }finally{await db.close();}
}
export async function qualifyStakeWallet(gameId:string,_p:any):Promise<any>{
 const child=spawn(process.execPath,['--import','tsx','scripts/database-test.ts','--import','tsx','scripts/game-math/stakes-wallet.ts','--run',gameId],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});let output='',errors='';
 child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>errors+=String(chunk));
 const exit=await new Promise<number|null>((accept,reject)=>{child.once('error',reject);child.once('exit',accept);});
 if(exit!==0)throw Error('Common-wallet qualification failed: '+errors+output);
 const line=output.split('\n').find(s=>s.startsWith('STAKE_WALLET_JSON '));if(!line)throw Error('Missing wallet qualification evidence');return JSON.parse(line.slice(18));
}
if(process.argv.includes('--run')){
 const game=process.argv[process.argv.indexOf('--run')+1],registry=JSON.parse(readFileSync(new URL('./rtp-policy.json',import.meta.url),'utf8'));
 try{console.log('STAKE_WALLET_JSON '+JSON.stringify(await runWallet(game,registry.stakePolicies[game])));}catch(error){console.error(error);process.exitCode=1;}
}
