import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { resolveCasinoPosting } from '../server/audit/casino';
import { PostgresDatabase } from '../server/database';
import { DemoExpansionStore } from '../server/demoExpansion';
import { DemoWalletStore } from '../server/demoWallet';
import { demoBalanceUnits } from '../server/demoWalletAmounts';
import { cardEngine } from '../server/games/cardEngine';
import { ROYAL_PLATFORM_GAMES } from '../src/shared/arcadeCatalog';
import { settingsFor } from '../scripts/game-math/stake-runtime.mjs';
import { cascadeRandom } from '../scripts/game-math/rtp-temple-cascade-model.mjs';

const accountId = 'audit-casino-player';

async function fixture() {
  const db = new PostgresDatabase(':memory:');
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts(id) VALUES (?)').run(accountId);
  const wallet = new DemoWalletStore(db, cascadeRandom(129733));
  await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 10000 });
  return { db, wallet };
}

async function postings(db: PostgresDatabase, operationId: string) {
  return db.prepare(`SELECT id::text AS id, source, entry_type, amount_units
    FROM demo_ledger WHERE account_id=? AND operation_id=? ORDER BY id`).all(accountId, operationId);
}

const sessionModes: Record<string, readonly [string, string, string]> = {
  'studio-cosmic-escape': ['cosmic-chaos', 'cosmic-chaos', '2'],
  'studio-caramel-carnival': ['festival', 'festival', '2'],
  'studio-velvet-reign': ['booster', 'booster', '2'],
  'studio-last-convoy': ['normal', 'normal', '2'],
  'studio-nitro-run': ['normal', 'normal', '2'],
  'studio-afterglow': ['normal', 'normal', '2'],
  'studio-meme-overload': ['normal', 'normal', '2'],
  'studio-dracona': ['normal', 'normal', '3'],
  'studio-neopolis': ['prism', 'prism', '4'],
  'studio-forest-heart': ['optimal', 'normal', '1'],
  'github-crash': ['all-server-cashout-times', 'normal', '1'],
  'original-cr-vs-leo': ['all-adaptive-risk-paths', 'normal', '1'],
  'original-jackie-chan': ['all-adaptive-risk-paths', 'normal', '1'],
  'studio-caribbean-treasures': ['lines-5-buy-raid', 'buy-raid', '2'],
  'studio-flooded-temple': ['normal', 'normal', '2'],
  'flag-battle': ['world', 'world', '2'],
  'studio-wild-nudge': ['normal', 'normal', '2'],
};

test('C1 source keys link distinct stake and payout rows to one accepted operation', async () => {
  const { db, wallet } = await fixture();
  try {
    for (const [gameId, input] of [
      ['royal-roulette', { bet: 'black' }],
      ['royal-plinko', { rows: 12, risk: 'easy' }],
    ] as const) {
      const operation = { id: randomUUID(), kind: 'play', gameId, input, amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 };
      await wallet.operate(accountId, operation);
      await wallet.operate(accountId, operation);
      const rows = await postings(db, operation.id);
      assert.deepEqual(rows.map(row => row.entry_type), ['bet', 'win']);
      const rowKey = JSON.stringify([accountId, operation.id]);
      for (const row of rows) {
        const input = { rowId: row.id, accountId, operationId: operation.id, gameId };
        const entitySource = { namespace: db.schema + '.demo_operations', rowId: rowKey };
        assert.deepEqual(await resolveCasinoPosting(db, input), {
          source: { namespace: db.schema + '.demo_ledger', rowId: row.id },
          entity: { category: 'casino', kind: 'round', gameId, modeId: 'normal', rulesVersion: '1',
            source: entitySource, ticketId: null },
          operation: entitySource, origin: 'command', coverage: 'complete',
        });
        assert.equal(await resolveCasinoPosting(db, { ...input, accountId: 'another-player' }), null);
        assert.equal(await resolveCasinoPosting(db, { ...input, operationId: randomUUID() }), null);
      }
      assert.notEqual(rows[0].id, rows[1].id);
    }
    const deposit = (await db.prepare("SELECT id::text AS id,operation_id,source FROM demo_ledger WHERE entry_type='deposit'").get())!;
    assert.equal(await resolveCasinoPosting(db, { rowId: deposit.id, accountId, operationId: deposit.operation_id, gameId: deposit.source }), null);
  } finally {
    await db.close();
  }
});

test('C2 resolves every approved session game from saved settings and rules', async () => {
  const { db, wallet } = await fixture();
  try {
    assert.deepEqual(Object.keys(sessionModes).sort(), ROYAL_PLATFORM_GAMES.filter(
      game => game !== 'royal-plinko' && game !== 'royal-roulette',
    ).sort());
    for (const [gameId, [choice, modeId, rulesVersion]] of Object.entries(sessionModes)) {
      const id = randomUUID();
      const request = { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: settingsFor(gameId, choice) };
      await wallet.expansion.operate(accountId, request, 2, true, true, true, true, true, true,
        true, true, 2, 4, true, true, 2, 2, 2, true);
      const rows = await postings(db, id);
      assert(rows.some(row => row.entry_type === 'bet'), gameId);
      for (const row of rows) {
        const result = await resolveCasinoPosting(db, { rowId: row.id, accountId, operationId: id, gameId });
        assert.deepEqual(result?.entity, { category: 'casino', kind: 'round', gameId, modeId, rulesVersion, ticketId: null,
          source: { namespace: db.schema + '.demo_casino_sessions', rowId: JSON.stringify([accountId, id]) },
        }, gameId);
        assert.deepEqual(result?.operation, { namespace: db.schema + '.demo_casino_requests', rowId: JSON.stringify([accountId, id]) }, gameId);
        assert.equal(result?.coverage, 'complete', gameId);
      }
      if (gameId === 'studio-caramel-carnival') {
        const row = rows.find(row => row.entry_type === 'bet')!;
        await db.prepare(`UPDATE demo_casino_sessions SET payload=(payload::jsonb-'settings'-'rulesVersion')::text
          WHERE account_id=? AND id=?`).run(accountId, id);
        const partial = await resolveCasinoPosting(db, { rowId: row.id, accountId, operationId: id, gameId });
        assert.equal(partial?.coverage, 'partial');
        assert.equal(partial.entity.modeId, 'unknown');
        assert.equal(partial.entity.rulesVersion, null);
      }
    }
  } finally {
    await db.close();
  }
});

test('automatic Crash settlement keeps the round key without inventing a cashout command', async () => {
  const { db, wallet } = await fixture();
  try {
    let now = 10_000;
    const store = new DemoExpansionStore(db, async id => ({ balance: await demoBalanceUnits(db, id) / 100, entries: [] }),
      wallet.ready, async () => {}, () => 0, () => now, cardEngine, () => 100);
    const id = randomUUID(), gameId = 'github-crash';
    await store.operate(accountId, { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
    assert.deepEqual((await postings(db, id)).map(row => row.entry_type), ['bet']);
    now = 100_000;
    await store.settleDue(accountId);
    await store.settleDue(accountId);
    const rows = await postings(db, id);
    assert.deepEqual(rows.map(row => row.entry_type), ['bet', 'win']);
    assert.equal(rows[1].amount_units, 1000);
    const [start, auto] = await Promise.all(rows.map(row =>
      resolveCasinoPosting(db, { rowId: row.id, accountId, operationId: id, gameId })));
    assert(start && auto);
    assert.deepEqual(start.entity, auto.entity);
    assert.equal(start.origin, 'command');
    assert.equal(auto.origin, 'automatic');
    assert.equal(auto.operation, null);
    assert.equal(auto.coverage, 'complete');
    assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM demo_casino_requests WHERE account_id=?').get(accountId))!.n), 1);

    now += 10_000;
    const manualRound = randomUUID();
    await store.operate(accountId, { id: manualRound, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
    now += 4_000;
    const cashout = randomUUID();
    await store.operate(accountId, { id: cashout, gameId, action: 'move', sessionId: manualRound, move: 'cashout' });
    const manualRows = await postings(db, cashout);
    assert.equal(manualRows.length, 1);
    const manual = await resolveCasinoPosting(db, { rowId: manualRows[0].id, accountId, operationId: cashout, gameId });
    assert.equal(manual?.origin, 'command');
    assert.equal(manual.entity.source.rowId, JSON.stringify([accountId, manualRound]));
    assert.equal(manual.operation?.rowId, JSON.stringify([accountId, cashout]));
  } finally {
    await db.close();
  }
});
