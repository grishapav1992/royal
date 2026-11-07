import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditReplayStore } from '../server/audit/replay-store';
import { createReplayPackage } from '../server/audit/replay-package';
import { TsuTurnReplayCapture } from '../server/audit/replay-pvp-tsu-capture';
import { buildTsuTurnReplay, verifyTsuTurnReplay, type CapturedTsuReplay } from '../server/audit/replay-pvp-tsu';
import { persistCapturedTsuReplay } from '../server/audit/replay-pvp-tsu-storage';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { prepareViewerReplay } from '../src/audit/replay-viewer-model';
import type { PvpRequest } from '../src/shared/pvp';
import type { TsuEFaChoice } from '../src/shared/tsuEFa';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(() => Promise.all([game.close(), audit.close()]));
  const a = { accountId: randomUUID(), roomId: 'audit-tsu-replay', name: 'Fixture A' };
  const b = { ...a, accountId: randomUUID(), name: 'Fixture B' };
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(a.accountId, b.accountId);
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  for (const actor of [a, b]) await wallet.operate(actor.accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const ledger = new VirtualPvpLedger(game, wallet);
  const store = new PvpStore(ledger), combat = new NileCombatEscrow(ledger);
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const replays = new AuditReplayStore(audit);
  await Promise.all([store.ready, combat.ready, datasets.ready, replays.ready]);
  const { datasetId, startedAtMs } = await datasets.startTest();
  const scope = { datasetId, environment: 'test' } as const;
  const recordings: CapturedTsuReplay[] = [], capture = new TsuTurnReplayCapture(row => recordings.push(row));
  let now = startedAtMs;
  const sync = async (at: number, connected = true) => {
    now = at;
    const snapshots = await store.syncRoom(a.roomId, [
      { ...a, available: true, connected: true }, { ...b, available: true, connected },
    ], now);
    for (const row of snapshots) capture.observeSnapshot(row.snapshot);
    return snapshots[0].snapshot;
  };
  const command = async (actor: typeof a, request: PvpRequest, captureReply = true) => {
    const reply = await store.command(actor, request, ++now);
    if (captureReply) capture.observeCommand(actor.accountId, request, reply);
    return reply;
  };
  await sync(now);
  const invitation = await command(a, { id: randomUUID(), action: 'invite', gameId: 'tsu-e-fa',
    stakeUnits: '100000', targetId: b.accountId });
  const matchId = invitation.active!.id;
  await command(b, { id: randomUUID(), action: 'accept', challengeId: matchId });
  for (const actor of [a, b]) {
    await command(actor, { id: randomUUID(), action: 'duel-ready', challengeId: matchId, termsRevision: 0 });
  }
  const move = (actor: typeof a, round: number, choice: TsuEFaChoice, id = randomUUID(), captureReply = true) =>
    command(actor, { id, action: 'move', challengeId: matchId, revision: 0, move: { kind: 'choose', round, choice } }, captureReply);
  return { game, audit, replays, scope, a, b, matchId, sync, command, move, now: () => now, recordings };
}

test('v4 records server reveals, reconnect and exact wallet links without exporting choices early', async t => {
  const f = await fixture(t);
  const id = randomUUID();
  const first = await f.move(f.a, 1, 'rock', id);
  assert.equal(first.tsuEFa?.choice, 'rock');
  await f.move(f.a, 1, 'rock', id);
  await f.sync(f.now() + 100, false);
  await f.sync(f.now() + 100, true);
  const locked = await f.move(f.b, 1, 'scissors');
  const firstReveal = await f.sync(locked.tsuEFa!.duel!.endsAt);
  await f.sync(firstReveal.tsuEFa!.duel!.endsAt);
  await f.move(f.a, 2, 'paper');
  const both = await f.move(f.b, 2, 'rock');
  await f.sync(both.tsuEFa!.duel!.endsAt);
  assert.equal(f.recordings.length, 1);
  const recording = f.recordings[0];
  assert.equal(recording.settlement.winnerSeat, 1);
  assert.deepEqual(recording.gaps, []);
  const actions = recording.events.flatMap(({ data }) => data.kind === 'action' ? [data.action] : []);
  assert.deepEqual(actions.map(action => action.profile === 'pvp-turn-based' && action.positions), [[1], [1], [2], [2]]);
  const firstThree = recording.events.flatMap(({ data }) => data.kind === 'checkpoint' ? [data.state] : []).slice(0, 3);
  assert.ok(firstThree.every(state => state.profile === 'pvp-turn-based' && state.board.slice(5).every(value => value === 0)));
  assert.deepEqual(recording.events.filter(event => event.data.kind === 'presence').map(({ data }) =>
    data.kind === 'presence' && [data.event, data.seat]), [['disconnected', 2], ['reconnected', 2]]);
  assert.equal(await persistCapturedTsuReplay(f.audit, f.scope, f.game.schema, recording), 'recorded');
  assert.equal(await persistCapturedTsuReplay(f.audit, f.scope, f.game.schema, recording), 'replayed');
  const loaded = await f.replays.read(f.scope, f.matchId);
  assert.equal(loaded.status, 'verified');
  if (loaded.status !== 'verified') return;
  assert.deepEqual(verifyTsuTurnReplay(loaded.value), { status: 'verified', engineVerified: true });
  assert.equal(prepareViewerReplay(loaded.value).status, 'ready');
  const events = loaded.value.fragments.flatMap(fragment => fragment.events);
  assert.deepEqual(events[0].money?.map(leg => leg.units), ['-10', '-10']);
  assert.deepEqual(events.at(-1)?.money?.map(leg => leg.units), ['19']);
  assert.equal(events.at(-1)?.atMs, both.tsuEFa!.duel!.endsAt - first.tsuEFa!.duel!.startsAt);

  // Rehashing a false revealed winner must not make the transcript semantically valid.
  const corruptEvents = structuredClone(events);
  const end = corruptEvents.at(-1)!.data;
  if (end.kind === 'terminal' && end.state.profile === 'pvp-turn-based') end.state.board[8] = 2;
  const { formatVersion, scope, replayId, entityId, game, initial, coverage, gaps } = loaded.value.manifest;
  const invalid = createReplayPackage({ formatVersion, scope, replayId, entityId, game, initial, coverage, gaps }, corruptEvents);
  assert.equal(verifyTsuTurnReplay(invalid).status, 'corrupt');
});

test('timeout keeps a locked sign private, and a missed capture is reported as partial', async t => {
  const f = await fixture(t);
  const first = await f.move(f.a, 1, 'paper');
  const endsAt = first.tsuEFa!.duel!.endsAt;
  await f.sync(endsAt - 20_000);
  await f.sync(endsAt - 10_000);
  await f.sync(endsAt);
  const recording = f.recordings[0];
  const end = recording.events.at(-1)?.data;
  assert.equal(recording.settlement.reason, 'timeout');
  assert.ok(end?.kind === 'terminal' && end.state.profile === 'pvp-turn-based');
  assert.equal(end.winnerSeat, 1);
  assert.deepEqual(end.state.board.slice(5), [0, 0, 0, 0]);
  assert.deepEqual(verifyTsuTurnReplay(buildTsuTurnReplay(recording, f.scope)), { status: 'verified', engineVerified: true });

  const missed = await fixture(t);
  await missed.move(missed.a, 1, 'rock', randomUUID(), false);
  await missed.sync(missed.now() + 20);
  const both = await missed.move(missed.b, 1, 'scissors');
  await missed.command(missed.a, { id: randomUUID(), action: 'resign', challengeId: missed.matchId });
  assert.equal(both.tsuEFa?.duel?.stage, 'countdown');
  assert.deepEqual(missed.recordings[0].gaps, ['event-gap', 'terminal-unavailable']);
  const partial = buildTsuTurnReplay(missed.recordings[0], missed.scope);
  assert.deepEqual(verifyTsuTurnReplay(partial), { status: 'verified', engineVerified: false });
  assert.equal(partial.fragments.flatMap(fragment => fragment.events).length, 1);
});

test('a late repeat cannot supply the original time of an unobserved choice', async t => {
  const f = await fixture(t);
  const requestId = randomUUID();
  await f.move(f.a, 1, 'paper', requestId, false);
  await f.move(f.a, 1, 'paper', requestId);
  await f.command(f.b, { id: randomUUID(), action: 'resign', challengeId: f.matchId });
  assert.equal(await persistCapturedTsuReplay(f.audit, f.scope, f.game.schema, f.recordings[0]), 'recorded');
  const loaded = await f.replays.read(f.scope, f.matchId);
  assert.equal(loaded.status, 'verified');
  if (loaded.status !== 'verified') return;
  assert.deepEqual(loaded.value.manifest.gaps, ['event-gap', 'terminal-unavailable']);
  assert.equal(loaded.value.fragments.flatMap(fragment => fragment.events).length, 1);
});
