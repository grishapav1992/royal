import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import { buildCapturedCasinoReplay, persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { planReplaySeek, verifyReplayPackage } from '../server/audit/replay-package';
import { AuditReplayStore } from '../server/audit/replay-store';
import { PostgresDatabase } from '../server/database';
import { DemoExpansionStore } from '../server/demoExpansion';
import { DemoWalletStore } from '../server/demoWallet';
import { demoBalanceUnits } from '../server/demoWalletAmounts';
import { cardEngine } from '../server/games/cardEngine';
import { ROYAL_PLATFORM_GAMES } from '../src/shared/arcadeCatalog';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../src/shared/caribbeanTreasures';
import { settingsFor } from '../scripts/game-math/stake-runtime.mjs';
import { cascadeRandom } from '../scripts/game-math/rtp-temple-cascade-model.mjs';

async function fixture(t: TestContext, draw: (max: number) => number = () => 0) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close()]); });
  const account = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?)').run(account);
  const wallet = new DemoWalletStore(game, draw);
  await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 10000 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId, environment } = await datasets.startTest();
  const refs = async (operationId: string) => (await game.prepare(`SELECT id::text,entry_type,amount_units::text
    FROM demo_ledger WHERE account_id=? AND operation_id=? ORDER BY demo_ledger.id`).all(account, operationId))
    .map(row => ({ type: row.entry_type, units: row.amount_units, posting: { namespace: game.schema + '.demo_ledger', rowId: row.id } }));
  const request = async (operationId: string, replayId = randomUUID()) => ({
    datasetId, gameSchema: game.schema, posting: (await refs(operationId))[0].posting, replayId,
  });
  return { game, audit, account, wallet, datasets, scope: { datasetId, environment }, refs, request };
}

test('instant replay retains the accepted selection, server outcome, zero payout and precision receipt', async t => {
  const f = await fixture(t);
  assert.deepEqual(await buildCapturedCasinoReplay(f.audit, { ...f.scope, gameSchema: f.game.schema,
    posting: { namespace: f.game.schema + '.demo_ledger', rowId: '1' }, replayId: randomUUID() }),
  { status: 'unavailable', reason: 'not-captured' });
  const id = randomUUID();
  await f.wallet.operate(f.account,
    { id, kind: 'play', gameId: 'royal-roulette', input: { bet: 'black' }, amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 });
  const input = await f.request(id);
  const replay = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(replay.status, 'built');
  const { manifest, fragments } = replay.value;
  assert.equal(manifest.coverage, 'complete');
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.timing, 'source-order');
  assert.equal(manifest.entityId, id);
  const [stake, payout] = fragments[0].events;
  assert.deepEqual(stake.data, { kind: 'action', action: { profile: 'casino-steps', code: 'start', selection: [1] } });
  assert.deepEqual(payout.data, { kind: 'terminal', state: { profile: 'casino-steps', phase: 'settled', revision: 1, visible: [0] },
    outcome: 'settled', winnerSeat: null });
  const ledger = await f.refs(id);
  assert.deepEqual(stake.money, [{ movement: 'stake', units: '-10', posting: ledger[0].posting }]);
  assert.deepEqual(payout.money, [{ movement: 'payout', units: '0', posting: ledger[1].posting }]);
  assert.deepEqual(payout.calculation, { numerator: '0', denominator: '1', baseUnits: '0', creditedUnits: '0' });
  assert(fragments[0].events.every(event => event.atMs === 0));
  assert(!JSON.stringify(replay).includes(f.account));
  assert(!JSON.stringify(replay).includes('"ticket"'));

  const engine = { ...manifest.game, formatVersion: 2 };
  assert.equal(verifyReplayPackage(replay.value, [engine]).status, 'verified');
  assert.equal(planReplaySeek(replay.value, [engine], 2).status, 'ready');
  assert.equal((await persistCapturedCasinoReplay(f.audit, input)).status, 'stored');
  assert.equal((await persistCapturedCasinoReplay(f.audit, { ...input, posting: ledger[1].posting })).status, 'stored');
  const store = new AuditReplayStore(f.audit);
  assert.deepEqual(await store.read(f.scope, input.replayId), { status: 'verified', value: replay.value });
});

test('Caribbean paid start and free bonus steps follow saved revisions rather than request timestamps', async t => {
  const f = await fixture(t, cascadeRandom(129733));
  const id = randomUUID();
  const settings = { caribbean: { mode: 'buy-raid', lines: 5, stakeBasis: 'total' } } as const;
  const start = await f.wallet.expansion.operate(f.account,
    { id, gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings });
  const input = await f.request(id);
  const open = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(open.status, 'built');
  assert.deepEqual(open.value.manifest.gaps, ['terminal-unavailable']);
  assert.equal(open.value.manifest.terminal, null);
  assert.deepEqual(open.value.fragments[0].events[0].money,
    [{ movement: 'paid-option', units: '-' + caribbeanInitialCost(settings.caribbean, '100'), posting: input.posting }]);

  let session = start.session;
  const moveIds: string[] = [];
  while (session.state === 'active') {
    const moveId = randomUUID();
    moveIds.push(moveId);
    session = (await f.wallet.expansion.operate(f.account, {
      id: moveId, gameId: CARIBBEAN_GAME, action: 'move', sessionId: id, move: 'caribbean-spin', revision: session.view.caribbean!.revision,
    })).session;
  }
  await f.game.prepare('UPDATE demo_casino_requests SET created_at=1 WHERE account_id=? AND session_id=?').run(f.account, id);
  const settled = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(settled.status, 'built');
  assert.equal(settled.value.manifest.coverage, 'complete');
  const events = settled.value.fragments.flatMap(fragment => fragment.events);
  const free = events.filter(event => event.data.kind === 'action' && event.data.action.code === 'move');
  assert.equal(free.length, 14);
  assert(free.every(event => !event.money && !event.postings.length && event.atMs === 0));
  const boards = events.filter(event => event.data.kind !== 'action')
    .flatMap(event => event.data.kind !== 'action' && event.data.state.profile === 'casino-steps' && event.data.state.visible.length
      ? [event.data.state.visible] : []);
  assert.deepEqual(boards, session.view.caribbean!.spins.map(spin => spin.frame.grid));
  const settledPosting = (await f.refs(moveIds.at(-1)!))[0].posting;
  assert.deepEqual(events.at(-1)?.money, [{ movement: 'payout', units: session.returnedUnits, posting: settledPosting }]);
  assert.equal(events.at(-1)?.calculation?.creditedUnits, session.returnedUnits);
  assert(!JSON.stringify(settled).includes('"draws"'));

  await f.game.prepare('DELETE FROM demo_casino_requests WHERE account_id=? AND id=?').run(f.account, moveIds[4]);
  const incomplete = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(incomplete.status, 'built');
  assert.equal(incomplete.value.manifest.coverage, 'partial');
  assert.deepEqual(incomplete.value.manifest.gaps, ['event-gap', 'terminal-unavailable']);
  assert.equal(incomplete.value.fragments[0].events.length, 1);
});

test('automatic Crash closes with its actual payout and late cashout never becomes an action', async t => {
  const f = await fixture(t);
  let now = Date.now();
  const store = new DemoExpansionStore(f.game, async account => ({ balance: await demoBalanceUnits(f.game, account) / 100, entries: [] }),
    f.wallet.ready, async () => {}, () => 0, () => now, cardEngine, () => 2.3456);
  const id = randomUUID(), gameId = 'github-crash';
  await store.operate(f.account, { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
  const input = await f.request(id);
  const open = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(open.status, 'built');
  assert.deepEqual(open.value.fragments[0].events[1].data,
    { kind: 'checkpoint', state: { profile: 'casino-steps', phase: 'open', revision: 1, visible: [] } });
  now += 100_000;
  await store.settleDue(f.account);
  await store.operate(f.account, { id: randomUUID(), gameId, action: 'move', sessionId: id, move: 'cashout' });
  const after = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(after.status, 'built');
  assert.equal(after.value.manifest.coverage, 'complete');
  const events = after.value.fragments[0].events;
  assert.deepEqual(events.map(event => event.data.kind), ['action', 'terminal']);
  assert.equal(events[1].money?.[0].units, '0');
  assert.deepEqual(events[1].data, { kind: 'terminal',
    state: { profile: 'casino-steps', phase: 'settled', revision: 1, visible: [0, 0, 2, 10, 3, 4, 5, 6] },
    outcome: 'settled', winnerSeat: null });

  const manualId = randomUUID(), cashout = randomUUID();
  await store.operate(f.account, { id: manualId, gameId, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings: {} });
  now += 4_000;
  const cash = await store.operate(f.account, { id: cashout, gameId, action: 'move', sessionId: manualId, move: 'cashout' });
  const manual = await buildCapturedCasinoReplay(f.audit, await f.request(manualId));
  assert.equal(manual.status, 'built');
  const manualEvents = manual.value.fragments[0].events;
  assert.deepEqual(manualEvents.filter(event => event.data.kind === 'action').map(event => event.data.kind === 'action' && event.data.action.code),
    ['start', 'cashout']);
  assert.deepEqual(manualEvents.at(-1)?.money, [{ movement: 'payout', units: cash.session.returnedUnits, posting: (await f.refs(cashout))[0].posting }]);
  assert.equal((await persistCapturedCasinoReplay(f.audit, input)).status, 'stored');
  await f.datasets.sealTest(f.scope.datasetId);
  assert.deepEqual(await buildCapturedCasinoReplay(f.audit, input), { status: 'unavailable', reason: 'sealed-session-unavailable' });
  assert.equal((await new AuditReplayStore(f.audit).read(f.scope, input.replayId)).status, 'verified');
});

const choices: Record<string, string> = {
  'studio-cosmic-escape': 'cosmic-chaos', 'studio-caramel-carnival': 'festival', 'studio-velvet-reign': 'booster',
  'studio-last-convoy': 'normal', 'studio-nitro-run': 'normal', 'studio-afterglow': 'normal', 'studio-meme-overload': 'normal',
  'studio-dracona': 'normal', 'studio-neopolis': 'prism', 'studio-forest-heart': 'optimal',
  'github-crash': 'all-server-cashout-times', 'original-cr-vs-leo': 'all-adaptive-risk-paths',
  'original-jackie-chan': 'all-adaptive-risk-paths', 'studio-caribbean-treasures': 'lines-5-buy-raid',
  'studio-flooded-temple': 'normal', 'flag-battle': 'world', 'studio-wild-nudge': 'normal',
};

test('approved casino game starts produce bounded replay evidence from the real stores', async t => {
  const f = await fixture(t, cascadeRandom(129733));
  assert.deepEqual([...Object.keys(choices), 'royal-roulette', 'royal-plinko'].sort(), [...ROYAL_PLATFORM_GAMES].sort());
  const plinko = randomUUID();
  await f.wallet.operate(f.account, { id: plinko, kind: 'play', gameId: 'royal-plinko',
    input: { rows: 12, risk: 'expert' }, amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 });
  const board = await buildCapturedCasinoReplay(f.audit, await f.request(plinko));
  assert.equal(board.status, 'built');
  assert.equal(board.value.manifest.coverage, 'complete');
  for (const [gameId, choice] of Object.entries(choices)) {
    const id = randomUUID();
    const { session } = await f.wallet.expansion.operate(f.account, {
      id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: settingsFor(gameId, choice),
    }, 2, true, true, true, true, true, true, true, true, 2, 4, true, true, 2, 2, 2, true);
    const result = await buildCapturedCasinoReplay(f.audit, await f.request(id));
    assert.equal(result.status, 'built', JSON.stringify({ gameId, result }));
    assert.deepEqual(result.value.manifest.gaps, session.state === 'active' ? ['terminal-unavailable'] : [], gameId);
  }
});
