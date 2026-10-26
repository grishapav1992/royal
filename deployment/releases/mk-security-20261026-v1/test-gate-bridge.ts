// Independent integration of the release supervisor, real PostgreSQL and real wallet funding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {readFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PostgresDatabase} from '../../../server/database';
import {DemoWalletStore} from '../../../server/demoWallet';
import {VirtualPvpLedger} from '../../../server/pvp/virtual-wallet';
import {PvpStore} from '../../../server/pvp/store';
import {NileCombatEscrow} from '../../../server/finance/combat-escrow';

test('supervised release gate keeps one real transaction beyond old lease and idle timeout', {timeout:65000}, async () => {
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.PGHOST,'127.0.0.1');
 process.env.PGLOCK_TIMEOUT_MS='30000';process.env.PGSTATEMENT_TIMEOUT_MS='60000';
 const folder=new URL('./',import.meta.url),helpers=folder;
 const hash=(name:string)=>createHash('sha256').update(readFileSync(new URL(name,helpers))).digest('hex');
 const pins=Object.fromEntries(['financial_gate.py','quiesce.cjs'].map(name=>[name,hash(name)]));
 const result:any={checkedAt:new Date().toISOString(),productionAccess:false,passed:false,helperSha256:pins};
 const db=new PostgresDatabase('royal_game'),a=randomUUID(),b=randomUUID();
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
 for(const id of[a,b])await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
 const common=new DemoWalletStore(db),ledger=new VirtualPvpLedger(db,common),store=new PvpStore(ledger),escrow=new NileCombatEscrow(ledger);
 let child:ReturnType<typeof spawn>|undefined,exit:Promise<any[]>|undefined,pending:Promise<any>|undefined,temporary:string|undefined;
 const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 try{
  await store.ready;await escrow.ready;
  for(const id of[a,b])await common.operate(id,{id:randomUUID(),kind:'deposit',amount:200});
  temporary=realpathSync(mkdtempSync(join(tmpdir(),'royal-gate-bridge-')));
  child=spawn(process.env.ROYAL_TEST_PYTHON||'python3',
   [fileURLToPath(new URL('./test-gate-bridge.py',import.meta.url)),process.execPath,join(temporary,'gate.log')],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});
  exit=once(child,'exit');let stderr='';const events:any[]=[];child.stderr!.on('data',value=>{stderr+=value;});
  const lines=createInterface({input:child.stdout!});lines.on('line',line=>events.push(JSON.parse(line)));
  const until=async(check:()=>boolean,timeout=10000)=>{const deadline=Date.now()+timeout;while(!check()){assert.equal(child!.exitCode,null,stderr);assert(Date.now()<deadline,'Bridge event did not arrive');await delay(20);}};
  await until(()=>events.some(e=>e.phase==='acquired'));
  const started=Date.now();
  const transaction=async()=>{const rows=await db.pool.query("SELECT pid,backend_xid::text AS xid,xact_start::text AS started FROM pg_stat_activity WHERE application_name='royal/security-release-gate' AND backend_xid IS NOT NULL");assert.equal(rows.rows.length,1);return rows.rows[0];};
  await delay(50);const before=await transaction();
  const probe=async(expected:boolean)=>{const connection=await db.pool.connect();try{await connection.query('BEGIN');const r=await connection.query("SELECT pg_try_advisory_xact_lock(hashtextextended('royal_game',0)) AS acquired");assert.equal(r.rows[0].acquired,expected);await connection.query('ROLLBACK');}finally{connection.release();}};
  await probe(false);
  await delay(25000);
  const match={id:randomUUID(),accounts:[a,b] as [string,string],stakeUnits:'1000000'};
  let completed=false;pending=escrow.fund(a,match).then(value=>{completed=true;return value;});void pending.catch(()=>{});
  await until(()=>events.some(e=>e.phase==='held-past-35-seconds'),15000);
  assert(Date.now()-started>=35000);await delay(50);
  const after=await transaction();assert.deepEqual(after,before,'Heartbeat must preserve the same transaction and connection');
  await probe(false);assert.equal(completed,false);
  for(const id of[a,b])assert.equal((await common.snapshot(id)).balance,200);
  assert.equal(await db.prepare('SELECT 1 FROM combat_matches WHERE id=?').get(match.id),undefined);
  result.heldPastOldLeaseAndIdleTimeout=true;result.sameTransactionAndBackend=true;result.noEarlyFundingDebit=true;
  child.stdin!.end('release\n');const[code]=await exit;assert.equal(code,0,stderr);await pending;
  assert(events.some(e=>e.phase==='released'));assert.equal(completed,true);
  await probe(true);
  for(const id of[a,b])assert.equal((await common.snapshot(id)).balance,199);
  await escrow.settle(a,{...match,winner:''});
  for(const id of[a,b]){
   assert.equal((await common.snapshot(id)).balance,200);
   const rows=await db.prepare("SELECT entry_type,count(*) AS n,sum(amount_units) AS amount FROM demo_ledger WHERE account_id=? AND source='pvp:mortal-kombat' GROUP BY entry_type ORDER BY entry_type").all(id);
   assert.deepEqual(rows,[{entry_type:'bet',n:1,amount:-100},{entry_type:'refund',n:1,amount:100}]);
  }
  for(const name of Object.keys(pins))assert.equal(hash(name),pins[name],'Helper changed during verification');
  result.explicitAcknowledgedRelease=true;result.fundingAndRefundExactlyOnce=true;result.heldMs=Date.now()-started;result.passed=true;lines.close();
 }catch(error){result.failure=(error as Error).message;throw error;}
 finally{
  if(child?.exitCode===null){child.kill('SIGTERM');await Promise.race([exit!,delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  await pending?.catch(()=>{});await db.close();
  if(temporary){assert.equal(dirname(temporary),realpathSync(tmpdir()));assert.match(basename(temporary),/^royal-gate-bridge-/);rmSync(temporary,{recursive:true,force:true});}
  console.log(JSON.stringify({releaseGateBridge:result}));
 }
});
