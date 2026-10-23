import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import { playTestConfig, playTestSetup, block } from './helpers/nile-play-fixture';
import { nilePublicKeyAddress } from '../../server/finance/nile-address';
import { NilePlayLedger } from '../../server/finance/nile-play-ledger';

async function setup() {
  const key = createECDH('secp256k1'); key.setPrivateKey(Buffer.from('17'.padStart(64,'0'),'hex'));
  const publicKey=key.getPublicKey('hex','uncompressed'),second={userId:'second',address:nilePublicKeyAddress(publicKey),publicKey};
  const config={...playTestConfig,initialReserveUnits:'0',source:{...playTestConfig.source,addresses:[...playTestConfig.source.addresses,second]}};
  const c=await playTestSetup(':memory:',()=>0,config,'200000000');
  await c.source.ingest(block(101,'200000000',second.address)); await c.ledger.sync(c.source,await c.reconciliation());
  const a=randomUUID(),b=randomUUID();
  await c.ledger.claim(a,await c.ledger.invite('player')); await c.ledger.claim(b,await c.ledger.invite('second'));
  return {...c,a,b,config};
}
test('Nile stakes reserve the same available wallet and settle 50 + 50 into 95 and 5',async()=>{
  const c=await setup(),matchId=randomUUID(),hold={matchId,gameId:'durak',stakeUnits:'50000000'};
  try{
    await c.ledger.pvpHold(c.a,hold); await c.ledger.pvpHold(c.b,hold);
    let a=await c.ledger.wallet(c.a);assert.equal(a.state,'assigned');if(a.state!=='assigned')return;
    assert.equal(a.balanceUnits,'150000000');assert.equal(a.reservedUnits,'50000000');
    assert.equal((await c.ledger.pvpHold(c.a,hold)).replayed,true);
    await assert.rejects(c.ledger.pvpHold(c.a,{...hold,stakeUnits:'1000000'}),/play_idempotency_conflict/);
    await c.ledger.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'});
    a=await c.ledger.wallet(c.a);if(a.state!=='assigned')return;
    assert.equal(a.balanceUnits,'245000000');assert.equal(a.reservedUnits,'0');
    assert.equal((await c.ledger.wallet(c.b) as any).balanceUnits,'150000000');
    const audit=await c.ledger.audit();assert.equal(audit.houseUnits,'5000000');assert.equal(audit.totalUnits,'400000000');
    assert.equal((await c.ledger.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'})).replayed,true);
    await assert.rejects(c.ledger.pvpFinish(c.b,{matchId,winnerId:c.b,reason:'win'}),/play_idempotency_conflict/);
    await c.ledger.db.transaction(()=>c.ledger.db.prepare('UPDATE state SET source_at=1').run());
    assert.equal((await c.ledger.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'})).replayed,true);
  }finally{await c.close();}
});
test('open invitations, draws and server failures return all reservations without commission',async()=>{
  const c=await setup();
  try{
    for(const reason of ['cancel','expired','draw','server']){
      const matchId=randomUUID(),hold={matchId,gameId:'chess',stakeUnits:'50000000'};
      await c.ledger.pvpHold(c.a,hold);if(reason==='draw'||reason==='server')await c.ledger.pvpHold(c.b,hold);
      await c.ledger.pvpFinish(c.a,{matchId,winnerId:null,reason});
      assert.equal((await c.ledger.wallet(c.a) as any).balanceUnits,'200000000');
      assert.equal((await c.ledger.wallet(c.b) as any).balanceUnits,'200000000');
    }
    assert.equal((await c.ledger.audit()).houseUnits,'0');
  }finally{await c.close();}
});
test('concurrent invitations cannot double spend; outsiders and incomplete matches cannot receive a pot',async()=>{
  const c=await setup();
  try{
    const holds=Array.from({length:6},()=>({matchId:randomUUID(),gameId:'pool',stakeUnits:'50000000'}));
    const attempts=await Promise.allSettled(holds.map(hold=>c.ledger.pvpHold(c.a,hold)));
    assert.equal(attempts.filter(row=>row.status==='fulfilled').length,4);
    assert.equal((await c.ledger.wallet(c.a) as any).balanceUnits,'0');
    const matchId=holds[attempts.findIndex(row=>row.status==='fulfilled')].matchId;
    await assert.rejects(c.ledger.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'}),/invalid_pvp_result/);
    await assert.rejects(c.ledger.pvpFinish(c.b,{matchId,winnerId:null,reason:'cancel'}),/pvp_unavailable/);
    await c.ledger.pvpHold(c.b,{...holds[0],matchId});
    await assert.rejects(c.ledger.pvpFinish(c.a,{matchId,winnerId:randomUUID(),reason:'win'}),/invalid_pvp_result/);
    assert.equal((await c.ledger.audit()).totalUnits,'400000000');
  }finally{await c.close();}
});
