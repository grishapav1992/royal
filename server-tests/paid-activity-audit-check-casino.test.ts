import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { resolveCasinoPosting } from '../server/audit/casino';
import { checkCapturedCasinoRound, checkCasinoRound } from '../server/audit/check-casino';
import { AuditDatasets } from '../server/audit/datasets';
import { PostgresDatabase } from '../server/database';
import { DemoExpansionStore } from '../server/demoExpansion';
import { DemoWalletStore } from '../server/demoWallet';
import { demoBalanceUnits } from '../server/demoWalletAmounts';
import { cardEngine } from '../server/games/cardEngine';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { ROYAL_PLATFORM_GAMES } from '../src/shared/arcadeCatalog';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../src/shared/caribbeanTreasures';
import { settingsFor } from '../scripts/game-math/stake-runtime.mjs';
import { cascadeRandom } from '../scripts/game-math/rtp-temple-cascade-model.mjs';

const accountId = 'audit-casino-player';

async function fixture(draw: (max: number) => number = () => 0) {
  const db = new PostgresDatabase(':memory:');
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts(id) VALUES (?)').run(accountId);
  const wallet = new DemoWalletStore(db, draw);
  await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 10000 });
  return { db, wallet };
}

async function selectedRound(db: PostgresDatabase, id: string, gameId: string) {
  const start = await db.prepare("SELECT id::text FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type='bet'")
    .get(accountId, id);
  assert(start, gameId);
  const resolved = await resolveCasinoPosting(db, { rowId: start.id, accountId, operationId: id, gameId });
  assert(resolved, gameId);
  return { accountId, entity: resolved.entity };
}

test('instant casino uses the accepted stake and verifies the saved zero payout', async () => {
  const { db, wallet } = await fixture();
  try {
    const id = randomUUID(), gameId = 'royal-roulette';
    const operation = { id, kind: 'play', gameId, input: { bet: 'black' }, amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 };
    await wallet.operate(accountId, operation);
    await wallet.operate(accountId, operation);
    const key = await selectedRound(db, id, gameId);
    const before = await demoBalanceUnits(db, accountId);
    const result = await checkCasinoRound(db, key);
    assert.equal(result.state, 'settled');
    assert.equal(result.stake.status, 'match');
    assert.equal(result.stake.expectedUnits, '10');
    assert.deepEqual(result.steps.map(step => [step.kind, step.status, step.operationId]), [['stake', 'match', id]]);
    assert.equal(result.payout.status, 'match');
    assert.equal(result.payout.state, 'zero');
    assert.equal(result.payout.expectedUnits, '0');
    assert.equal(await demoBalanceUnits(db, accountId), before);
    assert.equal((await checkCasinoRound(db, { ...key, accountId: 'different-player' })).state, 'unknown');

    await db.prepare("UPDATE demo_ledger SET amount_units=10 WHERE account_id=? AND operation_id=? AND entry_type='bet'")
      .run(accountId, id);
    const wrongDebit = await checkCasinoRound(db, key);
    assert.equal(wrongDebit.stake.status, 'mismatch');
    assert.equal(wrongDebit.stake.observedUnits, '-10');

    await db.prepare("UPDATE demo_ledger SET amount_units=3 WHERE account_id=? AND operation_id=? AND entry_type='win'")
      .run(accountId, id);
    const wrongWin = await checkCasinoRound(db, key);
    assert.equal(wrongWin.payout.status, 'mismatch');
    assert.equal(wrongWin.payout.expectedUnits, '0');

    await db.prepare("DELETE FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type='win'").run(accountId, id);
    assert.equal((await checkCasinoRound(db, key)).payout.reason, 'posting-count');
  } finally {
    await db.close();
  }
});

test('paid option, open state and a completed free continuation use different evidence', async () => {
  const { db, wallet } = await fixture(cascadeRandom(129733));
  try {
    const id = randomUUID();
    const settings = { caribbean: { mode: 'buy-raid', lines: 5, stakeBasis: 'total' } } as const;
    const start = await wallet.expansion.operate(accountId,
      { id, gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings });
    const key = await selectedRound(db, id, CARIBBEAN_GAME);
    const open = await checkCasinoRound(db, key);
    assert.equal(open.state, 'open');
    assert.equal(open.payout.state, 'open');
    assert.equal(open.payout.status, 'match');
    assert.equal(open.steps[0].kind, 'paid-option');
    assert.equal(open.steps[0].expectedUnits, caribbeanInitialCost(settings.caribbean, '100'));
    assert.equal(open.steps[0].status, 'match');

    let session = start.session;
    const moveIds: string[] = [];
    while (session.state === 'active') {
      const moveId = randomUUID();
      moveIds.push(moveId);
      session = (await wallet.expansion.operate(accountId,
        { id: moveId, gameId: CARIBBEAN_GAME, action: 'move', sessionId: id, move: 'caribbean-spin',
          revision: session.view.caribbean!.revision })).session;
    }
    assert.equal(moveIds.length, 14);
    const settled = await checkCasinoRound(db, key);
    assert.equal(settled.state, 'settled');
    assert.equal(settled.payout.status, 'match');
    assert.equal(settled.payout.expectedUnits, session.returnedUnits);
    assert.equal(settled.stake.status, 'match');
    assert.deepEqual(settled.steps.filter(step => step.kind === 'free').map(step => step.operationId).sort(), moveIds.sort());
    assert(settled.steps.slice(1).every(step => step.status === 'match' && step.observedUnits === '0'));

    await db.prepare(`INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,entry_type,amount_units,balance_units,source)
      VALUES (?,?,'bet',0,0,0,'bet',-1,0,?)`).run(accountId, moveIds[0], CARIBBEAN_GAME);
    const wrongFreeStep = await checkCasinoRound(db, key);
    assert.equal(wrongFreeStep.stake.status, 'mismatch');
    assert.equal(wrongFreeStep.steps.find(step => step.operationId === moveIds[0])?.reason, 'posting-count');

    await db.prepare("DELETE FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type='bet'").run(accountId, moveIds[0]);
    const missingMove = await db.prepare('DELETE FROM demo_casino_requests WHERE account_id=? AND id=? RETURNING *')
      .get(accountId, moveIds[0]);
    const stepMissing = await checkCasinoRound(db, key);
    assert.equal(stepMissing.stake.reason, 'step-receipts-unavailable');
    assert.equal(stepMissing.payout.reason, 'step-receipts-unavailable');
    assert(!stepMissing.steps.some(step => step.operationId === moveIds[0]));
    await db.prepare('INSERT INTO demo_casino_requests VALUES (?,?,?,?,?)')
      .run(accountId, missingMove!.id, missingMove!.request_key, id, missingMove!.created_at);

    const saved = await db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(accountId, id);
    const payload = JSON.parse(saved!.payload);
    delete payload.precision;
    await db.prepare('UPDATE demo_casino_sessions SET payload=? WHERE account_id=? AND id=?')
      .run(JSON.stringify(payload), accountId, id);
    const receiptMissing = await checkCasinoRound(db, key);
    assert.equal(receiptMissing.payout.status, 'insufficient-data');
    assert.equal(receiptMissing.payout.reason, 'precision-unavailable');
  } finally {
    await db.close();
  }
});

test('accepted v1 Flag Battle and Caribbean keep their historical modes and ordinary stake', async () => {
  const { db, wallet } = await fixture(max => max - 1);
  try {
    for (const { gameId, modeId, settings, debit } of [
      { gameId: 'flag-battle', modeId: 'classic', settings: { flags: { country: 'RU' } }, debit: '100' },
      { gameId: CARIBBEAN_GAME, modeId: 'normal', settings: { caribbean: { mode: 'normal', lines: 20 } }, debit: '2000' },
    ] as const) {
      const id = randomUUID();
      const operation = { id, gameId, action: 'start', stakeUnits: '100', settings };
      const before = await demoBalanceUnits(db, accountId);
      const { session } = await wallet.expansion.operate(accountId, operation);
      assert.equal(session.rulesVersion, 1);
      assert.equal(session.state, 'settled');
      const retry = await wallet.expansion.operate(accountId, operation);
      assert.equal(retry.replayed, true);
      assert.deepEqual(retry.session, session);
      const key = await selectedRound(db, id, gameId);
      assert.equal(key.entity.modeId, modeId);
      assert.equal(key.entity.rulesVersion, '1');
      const result = await checkCasinoRound(db, key);
      assert.deepEqual(result.steps.map(step => [step.operationId, step.kind, step.status, step.expectedUnits, step.observedUnits]),
        [[id, 'stake', 'match', debit, debit]]);
      assert.equal(result.payout.status, 'match');
      assert.equal(result.payout.expectedUnits, session.returnedUnits);
      assert.equal(await demoBalanceUnits(db, accountId), before - Number(debit) + Number(session.returnedUnits));
    }
  } finally {
    await db.close();
  }
});

const expansionChoices: Record<string, string> = {
  'studio-cosmic-escape': 'cosmic-chaos',
  'studio-caramel-carnival': 'festival',
  'studio-velvet-reign': 'booster',
  'studio-last-convoy': 'normal',
  'studio-nitro-run': 'normal',
  'studio-afterglow': 'normal',
  'studio-meme-overload': 'normal',
  'studio-dracona': 'normal',
  'studio-neopolis': 'prism',
  'studio-forest-heart': 'optimal',
  'github-crash': 'all-server-cashout-times',
  'original-cr-vs-leo': 'all-adaptive-risk-paths',
  'original-jackie-chan': 'all-adaptive-risk-paths',
  'studio-caribbean-treasures': 'lines-5-buy-raid',
  'studio-flooded-temple': 'normal',
  'flag-battle': 'world',
  'studio-wild-nudge': 'normal',
};

test('every approved casino game has a verified current state and opening price', async () => {
  const { db, wallet } = await fixture(cascadeRandom(129733));
  try {
    assert.deepEqual([...Object.keys(expansionChoices), 'royal-plinko', 'royal-roulette'].sort(), [...ROYAL_PLATFORM_GAMES].sort());
    for (const [gameId, input] of [['royal-roulette', { bet: 'black' }], ['royal-plinko', { rows: 12, risk: 'easy' }]] as const) {
      const id = randomUUID();
      await wallet.operate(accountId, { id, kind: 'play', gameId, input, amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 });
      const result = await checkCasinoRound(db, await selectedRound(db, id, gameId));
      assert.equal(result.payout.status, 'match', gameId);
    }
    for (const [gameId, choice] of Object.entries(expansionChoices)) {
      const id = randomUUID();
      const { session } = await wallet.expansion.operate(accountId,
        { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: settingsFor(gameId, choice) },
        2, true, true, true, true, true, true, true, true, 2, 4, true, true, 2, 2, 2, true);
      const result = await checkCasinoRound(db, await selectedRound(db, id, gameId));
      assert.equal(result.stake.status, 'match', JSON.stringify({ gameId, result }));
      assert.equal(result.stake.expectedUnits, session.spentUnits, gameId);
      assert.equal(result.payout.status, 'match', JSON.stringify({ gameId, result }));
      assert.equal(result.payout.state, session.state === 'active' ? 'open' : session.returnedUnits === '0' ? 'zero' : 'paid', gameId);
    }
  } finally {
    await db.close();
  }
});

test('Crash automatic zero and manual cashout use one win each and late cashout is a no-op', async () => {
  const { db, wallet } = await fixture();
  try {
    let now = 10_000, crashPoint = 2;
    const store = new DemoExpansionStore(db, async id => ({ balance: await demoBalanceUnits(db, id) / 100, entries: [] }),
      wallet.ready, async () => {}, () => 0, () => now, cardEngine, () => crashPoint);
    const id = randomUUID(), gameId = 'github-crash';
    await store.operate(accountId, { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
    const key = await selectedRound(db, id, gameId);
    assert.equal((await checkCasinoRound(db, key)).state, 'open');
    now = 100_000;
    await store.settleDue(accountId);
    const late = randomUUID();
    await store.operate(accountId, { id: late, gameId, action: 'move', sessionId: id, move: 'cashout' });
    const automatic = await checkCasinoRound(db, key);
    assert.equal(automatic.payout.state, 'zero');
    assert.equal(automatic.payout.status, 'match');
    assert.deepEqual(automatic.steps.map(step => step.kind), ['stake', 'no-op']);

    crashPoint = 100;
    now += 10_000;
    const manualId = randomUUID();
    await store.operate(accountId, { id: manualId, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
    now += 4_000;
    const cashout = randomUUID();
    await store.operate(accountId, { id: cashout, gameId, action: 'move', sessionId: manualId, move: 'cashout' });
    const manual = await checkCasinoRound(db, await selectedRound(db, manualId, gameId));
    assert.equal(manual.payout.state, 'paid');
    assert.equal(manual.payout.status, 'match');
    assert.deepEqual(manual.steps.map(step => step.kind), ['stake', 'free']);
  } finally {
    await db.close();
  }
});

test('dataset authorizes captured postings and opening obligations, and freezes its historical coverage on seal', async t => {
  const { db, wallet } = await fixture();
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([db.close(), audit.close()]); });
  const pvp = new VirtualPvpLedger(db, wallet);
  await Promise.all([new PvpStore(pvp).ready, new NileCombatEscrow(pvp).ready]);
  const datasets = new AuditDatasets(audit, { game: db.schema });
  const instantGame = 'royal-roulette';
  const instant = (id: string) => wallet.operate(accountId,
    { id, kind: 'play', gameId: instantGame, input: { bet: 'black' }, amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 });
  const sessionGame = 'github-crash';
  let now = Date.now();
  const store = new DemoExpansionStore(db, async id => ({ balance: await demoBalanceUnits(db, id) / 100, entries: [] }),
    wallet.ready, async () => {}, () => 0, () => now, cardEngine, () => 2);
  const start = (id: string) => store.operate(accountId,
    { id, gameId: sessionGame, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
  const sourceFor = async (id: string) => {
    const row = await db.prepare("SELECT id::text FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type='bet'")
      .get(accountId, id);
    assert(row);
    return { namespace: db.schema + '.demo_ledger', rowId: row.id };
  };

  const oldId = randomUUID(), openingId = randomUUID();
  await instant(oldId);
  await start(openingId);
  const opening = await selectedRound(db, openingId, sessionGame);
  const { datasetId } = await datasets.startTest();
  const args = { datasetId, gameSchema: db.schema };
  assert.deepEqual(await checkCapturedCasinoRound(audit, { ...args, posting: await sourceFor(oldId) }),
    { status: 'not-captured' });
  assert.deepEqual(await checkCapturedCasinoRound(audit, { ...args, posting: await sourceFor(openingId) }),
    { status: 'not-captured' });
  const opened = await checkCapturedCasinoRound(audit, { ...args, opening });
  assert.equal(opened.status, 'found');
  assert.equal(opened.basis, 'current-source-only');
  assert.equal(opened.result.state, 'open');
  assert.deepEqual(await checkCapturedCasinoRound(audit, { ...args, opening: { ...opening, accountId: 'other-player' } }),
    { status: 'not-captured' });

  now += 100_000;
  await store.settleDue(accountId);
  const instantId = randomUUID(), sessionId = randomUUID();
  await instant(instantId);
  await start(sessionId);
  const instantPosting = await sourceFor(instantId), sessionPosting = await sourceFor(sessionId);
  const inside = await checkCapturedCasinoRound(audit, { ...args, posting: sessionPosting });
  assert.equal(inside.status, 'found');
  assert.equal(inside.basis, 'dataset');
  assert.equal(inside.result.state, 'open');
  assert.deepEqual(await checkCapturedCasinoRound(audit, { ...args, gameSchema: 'other_game', posting: sessionPosting }),
    { status: 'not-captured' });

  await datasets.sealTest(datasetId);
  now += 100_000;
  await store.settleDue(accountId);
  const sealed = await checkCapturedCasinoRound(audit, { ...args, posting: sessionPosting });
  assert.equal(sealed.status, 'found');
  assert.equal(sealed.basis, 'unavailable-as-of-seal');
  assert.equal(sealed.result.state, 'unknown');
  assert.equal(sealed.result.payout.reason, 'dataset-sealed');
  const immutable = await checkCapturedCasinoRound(audit, { ...args, posting: instantPosting });
  assert.equal(immutable.status, 'found');
  assert.equal(immutable.basis, 'dataset');
  assert.equal(immutable.result.payout.status, 'match');

  const saved = await db.prepare('SELECT result FROM demo_operations WHERE account_id=? AND operation_id=?').get(accountId, instantId);
  const result = JSON.parse(saved!.result);
  result.gameRound.multiplier = 17;
  await db.prepare('UPDATE demo_operations SET result=? WHERE account_id=? AND operation_id=?')
    .run(JSON.stringify(result), accountId, instantId);
  const damaged = await checkCapturedCasinoRound(audit, { ...args, posting: instantPosting });
  assert.equal(damaged.status, 'found');
  assert.equal(damaged.result.stake.status, 'match');
  assert.equal(damaged.result.payout.reason, 'saved-outcome-invalid');
});
