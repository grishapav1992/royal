import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { randomUUID } from 'node:crypto';
import { DemoWalletStore } from '../server/demoWallet';
import { CasinoApiProWallet } from '../server/casinoApiProWallet';
import { MAX_DEMO_UNITS, demoBalanceUnits, saveDemoUnits } from '../server/demoWalletAmounts';

test('provider credits wait without consuming Mines payout capacity and release once after cashout', async () => {
  const db = new PostgresDatabase(':memory:');
  (await db.exec(" CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('alice');"));
  const wallet = new DemoWalletStore(db, () => 0);
  const provider = new CasinoApiProWallet(db);
  try {
    (await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1000 }));
    const start = (await wallet.mines.operate('alice', { id: randomUUID(), action: 'start', amount: 100, mineCount: 1 }));
    assert.equal(start.session?.state, 'active');
    const reserve = (await wallet.mines.reservedUnits('alice'));
    (await saveDemoUnits(db, 'alice', MAX_DEMO_UNITS - reserve));
    const before = (await wallet.snapshot('alice'));
    const request = { playerId: (await provider.player('alice')), currency: 'USD', transactionId: 'credit-during-mines', amount: '0.01', roundId: 'external-round' };
    const accepted=await provider.callback('credit',request,'USD');
    assert.equal(accepted.duplicate,false);
    const waiting=await wallet.snapshot('alice');
    assert.equal(waiting.balance,before.balance);
    assert.equal(waiting.pendingBalance,'0.01');
    assert.equal(await wallet.mines.reservedUnits('alice'),reserve);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM capro_transactions').get())!.count, 1);
    assert.deepEqual(await provider.callback('credit',request,'USD'),{...accepted,duplicate:true});
    (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.session!.id, cell: 1 }));
    const ended = (await wallet.mines.operate('alice', { id: randomUUID(), action: 'cashout', sessionId: start.session!.id }));
    assert.equal(ended.session?.state, 'cashed_out');
    assert.equal((await wallet.mines.reservedUnits('alice')), 0);
    const balance = (await demoBalanceUnits(db, 'alice'));
    assert.equal(ended.wallet.pendingBalance,undefined);
    assert.equal(balance,Math.round(before.balance*100)+Math.round(ended.session!.payout*100)+1);
    assert.equal((await provider.callback('credit', request, 'USD')).duplicate, true);
    assert.equal((await demoBalanceUnits(db, 'alice')), balance);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM capro_transactions').get())!.count, 1);
  } finally { (await db.close()); }
});
