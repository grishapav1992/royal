import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { neutralCombatInput, type CombatInput } from '../src/shared/combat';
import { CombatRoom } from '../server/combatRoom';
import type { CombatEscrow } from '../server/combatWallet';
import { buildCombatReplay, CombatRealtimeReplayCapture, persistCapturedCombatReplay, reconstructCombatReplay as serverReconstructCombatReplay,
  type CapturedCombatReplay } from '../server/audit/replay-pvp-realtime';
import { reconstructCombatReplay, type CombatReplayFrame } from '../server/audit/replay-pvp-realtime-engine';
import { createReplayPackage, type ReplayEvent } from '../server/audit/replay-package';

const left = 'private-session-left';
const right = 'private-session-right';
const scope = { datasetId: randomUUID(), environment: 'test' } as const;
const memoryEscrow: CombatEscrow = {
  fund: async () => {}, recoverExpired: async () => {},
  settle: async (_id, winner = '') => ({ winner, fee: winner ? 0.1 : 0, payout: winner ? 1.9 : 0 }),
};

async function fight(source = memoryEscrow, accounts: readonly string[] = [randomUUID(), randomUUID()]) {
  let now = 1000;
  const records: CapturedCombatReplay[] = [];
  let settled!: (recording: CapturedCombatReplay) => void;
  const finished = new Promise<CapturedCombatReplay>(resolve => { settled = resolve; });
  const capture = new CombatRealtimeReplayCapture(recording => { records.push(recording); settled(recording); }, () => now);
  const room = new CombatRoom({ escrow: capture.escrow(source),
    account: id => id === left ? accounts[0] : id === right ? accounts[1] : undefined,
    name: id => 'private-name:' + id, now: () => now }, () => {});
  capture.attach(room);
  assert.equal(room.join(left), true);
  assert.equal(room.join(right), true);
  const match = room.state.id, stake = room.state.stake;
  for (const id of [left, right]) room.handle(id, { type: 'combat-ready', match, stake });
  for (let attempt = 0; attempt < 100 && room.state.phase === 'funding'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(room.state.phase, 'countdown');
  const sequences: Record<string, number> = {};
  const advance = (ms: number) => { now += ms; room.tick(ms / 1000); };
  const input = (id: string, change: Partial<CombatInput>, patch: Record<string, unknown> = {}) => {
    sequences[id] = (sequences[id] ?? 0) + 1;
    room.handle(id, { type: 'combat-input', match, seq: sequences[id], input: { ...neutralCombatInput(), ...change }, ...patch });
  };
  return { room, records, accounts, match, advance, input, finished };
}

const eventsOf = (pack: ReturnType<typeof buildCombatReplay>) => pack.fragments.flatMap(part => part.events);

test('replays only effective buttons on exact physics ticks, verifies snapshots and seeks between checkpoints', async () => {
  const { room, records, accounts, advance, input } = await fight();
  input(left, { jump: true }); // During countdown, replaced before any physics step.
  advance(3000);
  input(left, { left: true });
  input(left, { right: true });
  input(left, { kick: true }, { seq: 2 }); // Rejected stale sequence.
  input(right, { block: true }, { match: randomUUID() }); // Rejected wrong fight.
  input('spectator', { kick: true });
  advance(100); // Several real engine substeps, held right for all of them.
  advance(300); // Outer dt cap does not alter server clock expiry.
  room.disconnect(right);
  advance(50);
  room.reconnect(right);
  for (let step = 0; step < 200 && room.state.phase === 'playing'; step++) {
    input(left, { right: true, kick: true });
    advance(100);
  }
  await nextTurn();
  assert.equal(room.state.phase, 'finished');
  assert.equal(records.length, 1);
  assert.equal(records[0].winnerSeat, 1);
  assert.equal(records[0].walletWinnerSeat, 1);
  const replay = buildCombatReplay(records[0], scope);
  const events = eventsOf(replay);
  const actions = events.flatMap(event => event.data.kind === 'action' ? [event.data.action] : []);
  assert.deepEqual(actions.slice(0, 2), [
    { profile: 'pvp-realtime', code: 'input', seat: 1, tick: 1, buttons: 2 },
    { profile: 'pvp-realtime', code: 'input', seat: 1, tick: 7, buttons: 0 },
  ]);
  assert(actions.every(action => action.profile === 'pvp-realtime' && action.seat === 1 && (action.buttons & 4) === 0));
  assert.deepEqual(events.flatMap(event => event.data.kind === 'presence' ? [event.data] : []),
    [{ kind: 'presence', seat: 2, event: 'disconnected' }, { kind: 'presence', seat: 2, event: 'reconnected' }]);
  const end = events.at(-1)?.data;
  assert.equal(end?.kind === 'terminal' && end.outcome, 'settled');
  assert.equal(replay.manifest.coverage, 'complete');
  assert(events.some(event => event.data.kind === 'checkpoint' && event.data.state.profile === 'pvp-realtime' && event.data.state.tick >= 60));
  assert.equal(serverReconstructCombatReplay, reconstructCombatReplay);
  const timeline: { event: ReplayEvent; state: CombatReplayFrame }[] = [];
  const sought = reconstructCombatReplay(replay, 3, (event, state) => timeline.push({ event, state }));
  assert.equal(sought.status, 'verified');
  if (sought.status === 'verified') assert.equal(sought.state.fighters[0].x, 250500);
  assert.deepEqual(timeline.map(frame => frame.event.sequence), events.filter(event => event.data.kind !== 'presence').map(event => event.sequence));
  for (const { event, state } of timeline) {
    if (event.data.kind === 'action' && event.data.action.profile === 'pvp-realtime') assert.equal(state.tick, event.data.action.tick - 1);
    if (event.data.kind === 'checkpoint' || event.data.kind === 'terminal') assert.deepEqual(state, event.data.state);
  }
  const firstInput = timeline.find(frame => frame.event.data.kind === 'action')!;
  assert.equal(firstInput.state.fighters[0].x, 240000);
  assert.equal(reconstructCombatReplay(replay, 5401).status, 'unknown-tick');
  const wire = JSON.stringify(replay);
  for (const personal of [left, right, ...accounts, 'private-name', 'spectator']) assert(!wire.includes(personal));

  const checkpoint = events.find(event => event.data.kind === 'checkpoint' && event.sequence > 1)!;
  const modified = structuredClone(events);
  const altered = modified[checkpoint.sequence - 1].data;
  assert(altered.kind === 'checkpoint' && altered.state.profile === 'pvp-realtime');
  altered.state.fighters[0].health--;
  const { manifest } = replay;
  const forged = createReplayPackage({ formatVersion: 2, game: manifest.game, initial: manifest.initial, scope,
    replayId: manifest.replayId, entityId: manifest.entityId, coverage: 'complete', gaps: [] }, modified);
  assert.equal(reconstructCombatReplay(forged, undefined, () => assert.fail('corrupt timeline must not emit frames')).status, 'corrupt');
  const omittedPresence = createReplayPackage({ formatVersion: 2, game: manifest.game, initial: manifest.initial, scope,
    replayId: manifest.replayId, entityId: manifest.entityId, coverage: 'partial', gaps: ['event-gap'] },
  events.filter(event => event.data.kind !== 'presence'));
  assert.equal(reconstructCombatReplay(omittedPresence, undefined, () => assert.fail('sequence gap must not emit frames')).status, 'incomplete');
});

test('handles exact last fixed tick, a natural clock draw and both disconnect refunds', async () => {
  const timeout = await fight();
  timeout.advance(3000);
  for (let frame = 0; frame < 1000 && timeout.room.state.phase === 'playing'; frame++) timeout.advance(100);
  await nextTurn();
  assert.equal(timeout.records.length, 1);
  const draw = buildCombatReplay(timeout.records[0], scope);
  const last = eventsOf(draw).at(-1)?.data;
  assert(last?.kind === 'terminal' && last.state.profile === 'pvp-realtime');
  assert.equal(last.outcome, 'draw');
  assert(last.state.tick >= 5400 && last.state.tick <= 5401);
  assert.equal(reconstructCombatReplay(draw, last.state.tick).status, 'verified');

  const lost = await fight();
  lost.room.disconnect(left);
  lost.room.disconnect(right);
  lost.advance(20001);
  await nextTurn();
  assert.equal(lost.records.length, 1);
  const cancelled = eventsOf(buildCombatReplay(lost.records[0], scope)).at(-1)?.data;
  assert.equal(cancelled?.kind === 'terminal' && cancelled.outcome, 'cancelled');
});

test('bank acknowledgement is separate from the authoritative in-room forfeit', async () => {
  const game = await fight({ ...memoryEscrow, settle: async () => ({ winner: '', fee: 0, payout: 0 }) });
  game.advance(3000);
  game.advance(100);
  game.room.leave(right);
  assert.equal(game.records.length, 0);
  game.advance(1);
  await nextTurn();
  assert.equal(game.records.length, 1);
  assert.equal(game.records[0].winnerSeat, 1);
  assert.equal(game.records[0].walletWinnerSeat, null);
  const recorded = buildCombatReplay(game.records[0], scope);
  assert.deepEqual(recorded.manifest.gaps, ['source-unavailable']);
  const last = eventsOf(recorded).at(-1)?.data;
  assert.equal(last?.kind === 'terminal' && last.outcome, 'forfeited');
});

test('stores combat with actual wallet holds, forfeit payout and scoped posting links', {
  skip: process.env.NODE_ENV !== 'test',
}, async t => {
  const [{ accounts }, { PostgresDatabase }, { AuditDatasets }, { AuditReplayStore }, { CommonCombatWallet }] = await Promise.all([
    import('../server/accounts'), import('../server/database'), import('../server/audit/datasets'),
    import('../server/audit/replay-store'), import('../server/commonCombatWallet'),
  ]);
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), accounts.close()]); });
  await accounts.ready;
  const source = new PostgresDatabase(accounts.schema, { existingSchema: true });
  t.after(() => source.close());
  const players = await Promise.all([0, 1].map(seat => accounts.login('combat-audit-' + seat + '-' + randomUUID() + '@example.test', 'fixture-password-only')));
  const ids = players.map(player => player.account.id);
  for (const id of ids) await accounts.wallet.operate(id, { id: randomUUID(), kind: 'deposit', amount: 10 });
  const dataset = await new AuditDatasets(audit, { game: accounts.schema }).startTest();
  const funded = await fight(new CommonCombatWallet(accounts.combat, id => accounts.financeAdmin.assertAllowed(id)), ids);
  funded.advance(3000);
  funded.input(left, { right: true });
  funded.advance(100);
  funded.room.leave(right);
  funded.advance(16);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recording = await Promise.race([funded.finished,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Expected settled combat')), 3000); })])
    .finally(() => clearTimeout(timer));
  assert.equal(recording.winnerSeat, 1);
  assert.deepEqual(await source.prepare('SELECT winner_id,reason,fee_units FROM virtual_pvp_banks WHERE match_id=?').get(recording.matchId),
    { winner_id: ids[0], reason: 'win', fee_units: 10 });
  const storageScope = { datasetId: dataset.datasetId, environment: 'test' } as const;
  assert.equal(await persistCapturedCombatReplay(audit, storageScope, accounts.schema, recording), 'recorded');
  assert.equal(await persistCapturedCombatReplay(audit, storageScope, accounts.schema, recording), 'replayed');
  const saved = await new AuditReplayStore(audit).read(storageScope, recording.matchId);
  assert.equal(saved.status, 'verified');
  if (saved.status !== 'verified') return;
  assert.equal(saved.value.manifest.coverage, 'complete');
  const events = eventsOf(saved.value);
  assert.deepEqual(events[0].money?.map(posting => posting.units), ['-100', '-100']);
  assert.equal(events.at(-1)?.money?.[0]?.units, '190');
  assert.equal(reconstructCombatReplay(saved.value).status, 'verified');
});
