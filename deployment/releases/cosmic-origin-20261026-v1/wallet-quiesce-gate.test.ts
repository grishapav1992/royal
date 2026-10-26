// Actual financial release gate against temporary local PostgreSQL, no production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PostgresDatabase} from '../../../server/database';
import {DemoWalletStore} from '../../../server/demoWallet';
import {VirtualPvpLedger} from '../../../server/pvp/virtual-wallet';
import {PvpStore} from '../../../server/pvp/store';
import {NileCombatEscrow} from '../../../server/finance/combat-escrow';

test('Cosmic release gate waits for funded matches, holds the global advisory lock and releases funding on explicit stdin', {timeout:20000}, async () => {
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.PGHOST,'127.0.0.1');
 const helper=fileURLToPath(new URL('../../../deployment/releases/cosmic-origin-20261026-v1/quiesce.cjs',import.meta.url));
 const helperSha256=createHash('sha256').update(readFileSync(helper)).digest('hex');
 const result:any={checkedAt:new Date().toISOString(),helperSha256,productionAccess:false,passed:false};
 const db=new PostgresDatabase('royal_game'),a=randomUUID(),b=randomUUID();
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
 for(const id of [a,b])await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
 const common=new DemoWalletStore(db),ledger=new VirtualPvpLedger(db,common),store=new PvpStore(ledger),escrow=new NileCombatEscrow(ledger);
 let child:ReturnType<typeof spawn>|undefined,pending:Promise<unknown>|undefined,exited:Promise<unknown[]>|undefined;
 const match=()=>({id:randomUUID(),accounts:[a,b] as [string,string],stakeUnits:'1000000'});
 try{
  await store.ready;await escrow.ready;
  for(const id of [a,b])await common.operate(id,{id:randomUUID(),kind:'deposit',amount:200});
  const first=match();await escrow.fund(a,first);
  assert.equal((await common.snapshot(a)).balance,199);assert.equal((await common.snapshot(b)).balance,199);
  child=spawn(process.execPath,[helper],{env:process.env,stdio:['pipe','pipe','pipe']});
  exited=once(child,'exit');const events:any[]=[];let stderr='';child.stderr!.on('data',value=>{stderr+=value;});
  const lines=createInterface({input:child.stdout!});lines.on('line',line=>events.push(JSON.parse(line)));
  const until=async(check:()=>boolean)=>{const deadline=Date.now()+7000;while(!check()){assert.equal(child!.exitCode,null,stderr);assert(Date.now()<deadline,'Gate event did not arrive');await new Promise(resolve=>setTimeout(resolve,20));}};
  await until(()=>events.some(event=>event.waitingForMatches));assert(!events.some(event=>event.quiet));
  result.waitedForActiveFundedMatch=true;
  await escrow.settle(a,{...first,winner:''});await until(()=>events.some(event=>event.quiet&&event.financialLockHeld));
  result.quietAfterSettlement=true;
  const probe=await db.pool.connect();
  try{
   await probe.query('BEGIN');
   const lock=await probe.query("SELECT pg_try_advisory_xact_lock(hashtextextended('royal_game',0)) AS acquired");
   assert.equal(lock.rows[0].acquired,false,'The gate must hold the same global lock used by funding');
   await probe.query('ROLLBACK');
  }finally{probe.release();}
  result.globalRoyalGameAdvisoryLockHeld=true;
  let finished=false;const second=match();pending=escrow.fund(a,second).then(value=>{finished=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(finished,false);
  for(const id of [a,b])assert.equal((await common.snapshot(id)).balance,200,'Blocked funding must not debit either wallet');
  assert.equal(await db.prepare('SELECT 1 FROM combat_matches WHERE id=?').get(second.id),undefined);
  result.nextFundingBlockedWithoutEarlyDebit=true;
  child.stdin!.end('release\n');const [code]=await exited;assert.equal(code,0,stderr);await pending;
  assert.equal(finished,true);
  for(const id of [a,b])assert.equal((await common.snapshot(id)).balance,199);
  result.explicitStdinReleaseAllowedFunding=true;
  const available=await db.pool.connect();
  try{
   await available.query('BEGIN');
   const lock=await available.query("SELECT pg_try_advisory_xact_lock(hashtextextended('royal_game',0)) AS acquired");
   assert.equal(lock.rows[0].acquired,true);await available.query('ROLLBACK');
  }finally{available.release();}
  await escrow.settle(a,{...second,winner:''});
  for(const id of [a,b]){
   assert.equal((await common.snapshot(id)).balance,200);
   const entries=await db.prepare("SELECT entry_type,count(*) AS n,sum(amount_units) AS amount FROM demo_ledger WHERE account_id=? AND source='pvp:mortal-kombat' GROUP BY entry_type ORDER BY entry_type").all(id);
   assert.deepEqual(entries,[{entry_type:'bet',n:2,amount:-200},{entry_type:'refund',n:2,amount:200}]);
  }
  result.finalBalances=[200,200];result.holdEntriesPerAccount=2;result.refundEntriesPerAccount=2;
  assert.equal(createHash('sha256').update(readFileSync(helper)).digest('hex'),helperSha256,'Gate source changed during verification');
  lines.close();result.passed=true;
 }catch(error){result.failure=(error as Error).message;throw error;}
 finally{
  if(child?.exitCode===null){child.stdin!.end('release\n');await exited;}
  await pending?.catch(()=>{});await db.close();
  mkdirSync(new URL('../../../artifacts/work/cosmic-origin-release/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../../../artifacts/work/cosmic-origin-release/wallet-quiesce-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 }
});
