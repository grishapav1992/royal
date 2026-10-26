import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { PvpStore } from '../server/pvp/store';
import { NileCombatEscrow } from '../server/finance/combat-escrow';

test('release gate waits for funded fights and holds off the next reservation until explicitly released', {timeout:15000}, async () => {
  const db = new PostgresDatabase('royal_game'), a=crypto.randomUUID(),b=crypto.randomUUID();
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');for(const id of[a,b])await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
  const common=new DemoWalletStore(db),ledger=new VirtualPvpLedger(db,common),store=new PvpStore(ledger),escrow=new NileCombatEscrow(ledger);
  let child:ReturnType<typeof spawn>|undefined,pending:Promise<unknown>|undefined;
  const match=()=>({id:crypto.randomUUID(),accounts:[a,b],stakeUnits:'1000000'});
  try {
    await store.ready;await escrow.ready;
    for(const id of[a,b])await common.operate(id,{id:crypto.randomUUID(),kind:'deposit',amount:200});
    const first=match();await escrow.fund(a,first);
    child=spawn(process.execPath,[fileURLToPath(new URL('../deployment/releases/mk-security-20261026-v1/quiesce.cjs',import.meta.url))],{env:process.env,stdio:['pipe','pipe','pipe']});
    const exit=once(child,'exit'), events:any[]=[];let stderr='';child.stderr!.on('data',value=>{stderr+=value;});
    const lines=createInterface({input:child.stdout!});lines.on('line',line=>events.push(JSON.parse(line)));
    const until=async(check:()=>boolean)=>{const deadline=Date.now()+7000;while(!check()){assert(child!.exitCode===null,stderr);assert(Date.now()<deadline,'gate event did not arrive');await new Promise(resolve=>setTimeout(resolve,20));}};
    await until(()=>events.some(row=>row.event==='waiting'));assert(!events.some(row=>row.event==='quiet'));
    await escrow.settle(a,{...first,winner:''});await until(()=>events.some(row=>row.event==='quiet'&&row.financialLockHeld));
    const held=events.find(row=>row.event==='quiet'),nonce=crypto.randomUUID().replaceAll('-','');
    child.stdin!.write(JSON.stringify({op:'confirm',nonce})+'\n');
    await until(()=>events.some(row=>row.event==='confirmed'&&row.nonce===nonce));
    const confirmed=events.find(row=>row.event==='confirmed'&&row.nonce===nonce);
    assert.equal(confirmed.backendPid,held.backendPid);assert.equal(confirmed.transactionId,held.transactionId);
    assert.equal(confirmed.financialLockHeld,true);
    let finished=false;const second=match();pending=escrow.fund(a,second).then(value=>{finished=true;return value;});
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(finished,false);
    assert.equal((await common.snapshot(a)).balance,200,'a waiting reservation has not charged the wallet');
    const releaseNonce=crypto.randomUUID().replaceAll('-','');
    child.stdin!.write(JSON.stringify({op:'release',nonce:releaseNonce})+'\n');
    const [code]=await exit;assert.equal(code,0,stderr);
    assert(events.some(row=>row.event==='released'&&row.nonce===releaseNonce&&row.committed===true));await pending;
    assert.equal((await common.snapshot(a)).balance,199);
    await escrow.settle(a,{...second,winner:''});lines.close();
  }finally{
    if(child?.exitCode===null){child.stdin!.end();await once(child,'exit');}
    await pending?.catch(()=>{});await db.close();
  }
});
