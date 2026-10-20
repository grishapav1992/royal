import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LastExitCashoutDelay } from '../server/lastExitCashoutDelay';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { cardEngine } from '../server/games/cardEngine';

test('real cashout waits 200 ms; starts do not wait and retries share the gate', async () => {
  const gate = new LastExitCashoutDelay();
  const action = { id: randomUUID(), gameId: 'github-crash' as const, action: 'move' as const, sessionId: randomUUID(), move: 'cashout' };
  const at = performance.now();
  await Promise.all([gate.wait('a', action), gate.wait('a', action)]);
  assert(performance.now() - at >= 195);
  let calls = 0;
  const fake = new LastExitCashoutDelay(async ms => { assert.equal(ms, 200); calls++; });
  await fake.wait('a', { id: randomUUID(), gameId: 'github-crash', action: 'start', stakeUnits: '50000', settings: {} });
  assert.equal(calls, 0);
  await Promise.all([fake.wait('a', action), fake.wait('a', action)]);
  assert.equal(calls, 1);
  await fake.wait('b', action);
  assert.equal(calls, 2);
});

test('wallet accepts after the delay, including crash during wait, first millisecond at the deadline and duplicate protection', async () => {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('delay')");
  const wallet = new DemoWalletStore(db, () => 0);
  await wallet.operate('delay', { id: randomUUID(), kind: 'deposit', amount: 10000 });
  await wallet.expansion.ready;
  let now = 100000, point = 10, waits = 0;
  const gate = new LastExitCashoutDelay(async ms => { waits++; now += ms; });
  const store = new DemoExpansionStore(db, async id => ({ balance: await demoBalanceUnits(db, id) / 100, entries: [] }), wallet.ready, async () => {}, () => 0, () => now, cardEngine, () => point, gate);
  try {
    for (const scenario of ['win', 'crash-during-wait', 'deadline-boundary'] as const) {
      point = scenario === 'win' ? 10 : 1.005;
      now += 100000;
      const before = await demoBalanceUnits(db, 'delay');
      const round = (await store.operate('delay', { id: randomUUID(), gameId: 'github-crash', action: 'start', stakeUnits: '50000', settings: {} })).session;
      now = scenario === 'deadline-boundary' ? Math.ceil(round.startedAt! + Math.log(point) / .06 * 1000) - 200 : round.startedAt!;
      const clickAt = now, previousWaits = waits;
      const action = { id: randomUUID(), gameId: 'github-crash' as const, action: 'move' as const, sessionId: round.id, move: 'cashout' };
      const replies = await Promise.all(Array.from({ length: 5 }, () => store.operate('delay', action)));
      assert.equal(waits, previousWaits + 1);
      assert.equal(now, clickAt + 200);
      const expected = scenario === 'win' ? '50500' : '0';
      assert(replies.every(reply => reply.session.returnedUnits === expected));
      assert.equal(await demoBalanceUnits(db, 'delay'), before - 50000 + Number(expected));
      assert.equal(await demoReservedUnits(db, 'delay'), 0);
      await store.operate('delay', action);
      assert.equal(waits, previousWaits + 1);
      assert.equal(await demoBalanceUnits(db, 'delay'), before - 50000 + Number(expected));
    }
  } finally { await db.close(); }
});
