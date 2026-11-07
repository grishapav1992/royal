import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { PvpCardGameId, PvpRequest } from '../src/shared/pvp';
import { AuditDatasets } from '../server/audit/datasets';
import { CardsTurnReplayCapture, cardTurnReplayDefinitions, decodeCardReplayAction, decodeCardReplayPosition,
  verifyCardTurnReplay, type CapturedCardReplay } from '../server/audit/replay-pvp-cards';
import { persistCapturedCardReplay } from '../server/audit/replay-pvp-cards-storage';
import { AuditReplayStore } from '../server/audit/replay-store';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const actors = ['A private fixture', 'B private fixture'].map(name => ({ accountId: randomUUID(), name, roomId: 'cards-replay' }));
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(actors[0].accountId, actors[1].accountId);
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  for (const actor of actors) await wallet.operate(actor.accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const ledger = new VirtualPvpLedger(game, wallet);
  const store = new PvpStore(ledger), combat = new NileCombatEscrow(ledger);
  const datasets = new AuditDatasets(audit, { game: game.schema });
  await Promise.all([store.ready, datasets.ready, combat.ready]);
  const dataset = await datasets.startTest();
  const scope = { datasetId: dataset.datasetId, environment: 'test' as const };
  let now = dataset.startedAtMs;
  const people = actors.map(actor => ({ ...actor, connected: true, available: true }));
  await store.syncRoom(actors[0].roomId, people, now);
  const recordings: CapturedCardReplay[] = [];
  const capture = new CardsTurnReplayCapture(recording => recordings.push(recording));
  async function command(actorIndex: number, request: PvpRequest, observe = true) {
    const actor = actors[actorIndex];
    const snapshot = await store.command(actor, request, ++now);
    if (observe) capture.observeCommand(actor.accountId, request, snapshot);
    return snapshot;
  }
  async function start(gameId: PvpCardGameId, observe = true) {
    const created = await command(0, { id: randomUUID(), action: 'create', gameId, stakeUnits: '10000000', targetId: actors[1].accountId });
    const matchId = created.active!.id;
    await command(1, { id: randomUUID(), action: 'accept', challengeId: matchId });
    await command(0, { id: randomUUID(), action: 'ready', challengeId: matchId }, observe);
    const started = await command(1, { id: randomUUID(), action: 'ready', challengeId: matchId }, observe);
    return { matchId, started };
  }
  return { audit, game, scope, capture, recordings, actors, store, start, command, datasets,
    sync: (delta: number) => store.syncRoom(actors[0].roomId, people, now += delta),
    persist: (recording: CapturedCardReplay) => persistCapturedCardReplay(audit, scope, game.schema, recording),
    read: (matchId: string) => new AuditReplayStore(audit).read(scope, matchId, cardTurnReplayDefinitions),
  };
}

for (const gameId of ['durak', 'transfer-durak', 'crazy-eights'] as const) {
  test(gameId + ' records actual accepted card play and one payout without private hands or IDs', async t => {
    const f = await fixture(t);
    const { matchId, started } = await f.start(gameId);
    const starter = started.cards!.actor;
    const view = await f.store.snapshot(f.actors[starter], started.now);
    const move = gameId === 'crazy-eights' ? { kind: 'draw' } as const : view.cards!.moves.find(move => move.kind === 'attack')!;
    const request = { id: randomUUID(), action: 'move', challengeId: matchId, revision: 0, move } as const;
    await assert.rejects(f.command(1 - starter, request), /недоступен/i);
    const applied = await f.command(starter, request);
    const replayed = await f.command(starter, request);
    const resigned = await f.command(starter, { id: randomUUID(), action: 'resign', challengeId: matchId });
    assert.ok(replayed.now > applied.now);
    assert.equal(f.recordings.length, 1);
    assert.equal(f.recordings[0].moves.length, 1);
    assert.equal(await f.persist(f.recordings[0]), 'recorded');
    assert.equal(await f.persist(f.recordings[0]), 'replayed');
    const read = await f.read(matchId);
    assert.equal(read.status, 'verified');
    if (read.status !== 'verified') throw Error('Replay missing');
    const pack = read.value;
    assert.equal(verifyCardTurnReplay(pack).status, 'verified');
    assert.equal(pack.manifest.coverage, 'complete');
    assert.equal(pack.manifest.timing, undefined);
    const events = pack.fragments.flatMap(fragment => fragment.events);
    assert.deepEqual(events.map(event => event.data.kind), ['checkpoint', 'action', 'checkpoint', 'action', 'terminal']);
    const moveAt = applied.now - started.now, terminalAt = resigned.now - started.now;
    assert.deepEqual(events.map(event => event.atMs), [0, moveAt, moveAt, terminalAt, terminalAt]);
    const initial = events[0].data;
    assert.equal(initial.kind, 'checkpoint');
    assert.equal(initial.kind === 'checkpoint' && initial.state.profile === 'pvp-turn-based' &&
      decodeCardReplayPosition(gameId, initial.state.board)?.handCounts[0], gameId === 'crazy-eights' ? 7 : 6);
    const action = events[1].data;
    assert.ok(action.kind === 'action' && action.action.profile === 'pvp-turn-based');
    assert.equal(decodeCardReplayAction(gameId, action.action)?.kind, move.kind);
    if (gameId === 'crazy-eights') assert.deepEqual(action.action.positions, [7]);
    assert.deepEqual(events[0].money?.map(leg => leg.units), ['-1000', '-1000']);
    assert.deepEqual(events.at(-1)?.money?.map(leg => leg.units), ['1900']);
    const terminal = events.at(-1)?.data;
    assert.ok(terminal?.kind === 'terminal');
    assert.equal(terminal.winnerSeat, 2 - starter);
    assert.equal(terminal.outcome, 'forfeited');
    const serialized = JSON.stringify(pack);
    assert.ok(f.actors.every(actor => !serialized.includes(actor.accountId) && !serialized.includes(actor.name)));
    assert.ok(!serialized.includes(request.id));
    assert.ok(!serialized.includes('stock\":') && !serialized.includes('hands\":') && !serialized.includes('moves\":'));
  });
}

test('missing initial state and an unobserved move are explicit, with timeout proven from the stored result', async t => {
  const f = await fixture(t);
  const { matchId, started } = await f.start('crazy-eights', false);
  const side = started.cards!.actor;
  await f.command(side, { id: randomUUID(), action: 'move', challengeId: matchId, revision: 0, move: { kind: 'draw' } }, false);
  const next = await f.store.snapshot(f.actors[side], started.now);
  const allowed = next.cards!.moves[0];
  await f.command(side, { id: randomUUID(), action: 'move', challengeId: matchId, revision: 1, move: allowed });
  for (let i = 0; i < 5; i++) {
    for (const row of await f.sync(12_001)) f.capture.observeSnapshot(row.snapshot);
  }
  assert.equal(f.recordings.length, 1);
  assert.equal(await f.persist(f.recordings[0]), 'recorded');
  const read = await f.read(matchId);
  assert.equal(read.status, 'verified');
  if (read.status !== 'verified') throw Error('Replay missing');
  assert.equal(verifyCardTurnReplay(read.value).status, 'verified');
  assert.equal(read.value.manifest.initial, null);
  assert.equal(read.value.manifest.timing, 'source-order');
  assert.ok(read.value.fragments.every(fragment => fragment.events.every(event => event.atMs === 0)));
  assert.deepEqual(read.value.manifest.gaps, ['initial-state-unavailable', 'event-gap']);
  const events = read.value.fragments.flatMap(fragment => fragment.events);
  assert.deepEqual(events.map(event => event.sequence), [4, 5, 6]);
  assert.deepEqual(events.at(-1)?.data.kind === 'terminal' && events.at(-1)?.data, {
    kind: 'terminal', outcome: 'timed-out', winnerSeat: side + 1,
    state: { ...(events[1].data.kind === 'checkpoint' ? events[1].data.state : {}), phase: 'settled', seatToMove: null },
  });
});

test('a copied or deleted receipt cannot turn a partial transcript into accepted card history', async t => {
  const f = await fixture(t);
  const { matchId, started } = await f.start('durak');
  const side = started.cards!.actor;
  const view = await f.store.snapshot(f.actors[side], started.now);
  const move = view.cards!.moves.find(move => move.kind === 'attack')!;
  await f.command(side, { id: randomUUID(), action: 'move', challengeId: matchId, revision: 0, move });
  await f.command(side, { id: randomUUID(), action: 'resign', challengeId: matchId });
  const [recording] = f.recordings;
  await f.game.prepare('DELETE FROM pvp_requests WHERE account_id=? AND id=?').run(f.actors[side].accountId, recording.moves[0].requestId);
  assert.equal(await persistCapturedCardReplay(f.audit, { ...f.scope, datasetId: randomUUID() }, f.game.schema, recording), 'not-captured');
  assert.equal(await persistCapturedCardReplay(f.audit, { ...f.scope, environment: 'live' }, f.game.schema, recording), 'not-captured');
  assert.equal(await f.persist(recording), 'recorded');
  const read = await f.read(matchId);
  assert.equal(read.status, 'verified');
  if (read.status !== 'verified') throw Error('Replay missing');
  assert.deepEqual(read.value.manifest.gaps, ['event-gap']);
  assert.deepEqual(read.value.fragments.flatMap(fragment => fragment.events).map(event => event.sequence), [1, 4, 5]);
});

test('an invitation cancelled before play records the actual hold and refund without inventing a board', async t => {
  const f = await fixture(t);
  const created = await f.command(0, { id: randomUUID(), action: 'create', gameId: 'durak', stakeUnits: '10000000', targetId: f.actors[1].accountId });
  const matchId = created.active!.id;
  const cancelled = await f.command(0, { id: randomUUID(), action: 'cancel', challengeId: matchId });
  f.capture.observeSnapshot(cancelled);
  assert.equal(f.recordings.length, 1);
  assert.equal(await f.persist(f.recordings[0]), 'recorded');
  const read = await f.read(matchId);
  assert.equal(read.status, 'verified');
  if (read.status !== 'verified') throw Error('Replay missing');
  assert.equal(verifyCardTurnReplay(read.value).status, 'verified');
  const events = read.value.fragments.flatMap(fragment => fragment.events);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    kind: 'terminal', outcome: 'cancelled', winnerSeat: null,
    state: { profile: 'pvp-turn-based', phase: 'cancelled', turn: 0, seatToMove: null, board: [] },
  });
  assert.deepEqual(events[0].money?.map(leg => [leg.movement, leg.units]), [['reserve', '-1000'], ['refund', '1000']]);
});

test('an accepted card move ending a match shares its resulting state with the exact terminal event', async t => {
  const f = await fixture(t);
  const { matchId, started } = await f.start('crazy-eights');
  let snapshot = started;
  for (let count = 0; snapshot.active?.status === 'playing' && count < 512; count++) {
    if (count % 5 === 0) await f.sync(5000);
    const side = snapshot.cards!.actor;
    const view = await f.store.snapshot(f.actors[side], snapshot.now);
    const move = view.cards!.moves[0];
    assert.ok(move);
    snapshot = await f.command(side, { id: randomUUID(), action: 'move', challengeId: matchId, revision: view.cards!.revision, move });
  }
  assert.equal(snapshot.active?.status, 'finished');
  assert.equal(f.recordings.length, 1);
  assert.equal(await f.persist(f.recordings[0]), 'recorded');
  const read = await f.read(matchId);
  assert.equal(read.status, 'verified');
  if (read.status !== 'verified') throw Error('Replay missing');
  assert.equal(verifyCardTurnReplay(read.value).status, 'verified');
  assert.equal(read.value.manifest.coverage, 'complete');
  const ending = read.value.fragments.flatMap(fragment => fragment.events).slice(-2);
  assert.deepEqual(ending.map(event => event.data.kind), ['action', 'terminal']);
  assert.deepEqual(ending.map(event => event.atMs), [snapshot.now - started.now, snapshot.now - started.now]);
});

test('a regressing canonical clock preserves both accepted moves in source order', async t => {
  const f = await fixture(t);
  const { matchId, started } = await f.start('crazy-eights');
  const side = started.cards!.actor;
  const draw = await f.command(side, { id: randomUUID(), action: 'move', challengeId: matchId, revision: 0, move: { kind: 'draw' } });
  const next = await f.store.snapshot(f.actors[side], draw.now);
  const secondId = randomUUID();
  await f.command(side, { id: secondId, action: 'move', challengeId: matchId, revision: 1, move: next.cards!.moves[0] });
  await f.command(side, { id: randomUUID(), action: 'resign', challengeId: matchId });
  await f.game.prepare('UPDATE pvp_requests SET created_at=? WHERE account_id=? AND id=?').run(started.now, f.actors[side].accountId, secondId);
  assert.equal(await f.persist(f.recordings[0]), 'recorded');
  const read = await f.read(matchId);
  assert.equal(read.status, 'verified');
  if (read.status !== 'verified') throw Error('Replay missing');
  assert.equal(verifyCardTurnReplay(read.value).status, 'verified');
  assert.equal(read.value.manifest.coverage, 'complete');
  assert.equal(read.value.manifest.timing, 'source-order');
  assert.deepEqual(read.value.fragments.flatMap(fragment => fragment.events.map(event => event.atMs)), [0, 0, 0, 0, 0, 0, 0]);
});
