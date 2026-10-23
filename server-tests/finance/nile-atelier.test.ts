import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { playTestSetup } from './helpers/nile-play-fixture';
import { NileGameRuntime } from '../../server/finance/nile-game-runtime';

test('atelier holds the Nile balance once, refunds while stale and captures into the same audited journal', async () => {
  const f = await playTestSetup();
  try {
    const owner = randomUUID(), other = randomUUID(), purchase = randomUUID();
    await f.ledger.claim(owner, await f.ledger.invite('player'));
    const games = new NileGameRuntime(f.ledger);
    await Promise.all([games.skinPurchase(owner,{id:purchase,action:'reserve'}),games.skinPurchase(owner,{id:purchase,action:'reserve'})]);
    assert.equal((await f.ledger.wallet(owner) as any).balanceUnits,'190000000');
    assert.equal((await f.ledger.wallet(owner) as any).reservedUnits,'10000000');
    await assert.rejects(() => games.skinPurchase(other,{id:purchase,action:'capture'}));
    await f.ledger.failure('source temporarily unavailable');
    await Promise.all([games.skinPurchase(owner,{id:purchase,action:'refund'}),games.skinPurchase(owner,{id:purchase,action:'refund'})]);
    assert.equal((await f.ledger.wallet(owner) as any).balanceUnits,'200000000');
    assert.equal((await f.ledger.wallet(owner) as any).reservedUnits,'0');
    await assert.rejects(() => games.skinPurchase(owner,{id:randomUUID(),action:'reserve'}));
    await f.ledger.sync(f.source,await f.reconciliation());
    const captured = randomUUID();
    await games.skinPurchase(owner,{id:captured,action:'reserve'});
    await Promise.all([games.skinPurchase(owner,{id:captured,action:'capture'}),games.skinPurchase(owner,{id:captured,action:'capture'})]);
    await assert.rejects(() => games.skinPurchase(owner,{id:captured,action:'refund'}));
    const audit = await f.ledger.audit();
    assert.equal(audit.ok,true); assert.equal(audit.totalUnits,'1000000000');
    assert.equal(audit.houseUnits,'810000000');
    assert.equal((await f.ledger.wallet(owner) as any).balanceUnits,'190000000');
    assert.equal((await f.ledger.wallet(owner) as any).reservedUnits,'0');
  } finally { await f.close(); }
});
