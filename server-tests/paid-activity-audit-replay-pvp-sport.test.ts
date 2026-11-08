import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { VIRTUAL_PVP_SCOPE, type PvpChallenge, type PvpRequest } from '../src/shared/pvp';
import { POOL_IDLE_TIMEOUT_MS } from '../src/shared/pool';
import { pvpSeat } from '../src/shared/pvpSeats';
import { prepareViewerReplay } from '../src/audit/replay-viewer-model';
import { AuditDatasets } from '../server/audit/datasets';
import { createReplayPackage, verifyReplayPackage, type SportGame, type SportReplayFrame } from '../server/audit/replay-package';
import { buildSportReplay, persistCapturedSportReplay, SportReplayCapture, type CapturedSportReplay } from '../server/audit/replay-pvp-sport';
import { reconstructSportReplay, sportReplayDefinitions, sportReplayFrame } from '../server/audit/replay-pvp-sport-engine';
import { AuditReplayStore } from '../server/audit/replay-store';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { virtualPvpCommand } from '../server/pvp/virtual-service';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { TableGame } from '../server/tableGames';

const sessions = ['fixture-session-one', 'fixture-session-two'];

function tableCapture(match: PvpChallenge) {
  const engine = new TableGame(match.gameId as SportGame);
  const recordings: CapturedSportReplay[] = [];
  let clock = 500;
  const capture = new SportReplayCapture(session => session === sessions[0] ? match.creatorId :
    session === sessions[1] ? match.opponentId ?? undefined : undefined, recording => recordings.push(recording), () => clock++);
  capture.observeMatches([match]);
  engine.setReplayObserver(event => capture.observeEngine(event));
  engine.join(sessions[0]); engine.join(sessions[1]);
  return { engine, capture, recordings };
}

async function fixture(t: TestContext, gameId: SportGame) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const actors = ['private first participant', 'private second participant']
    .map(name => ({ accountId: randomUUID(), name, roomId: 'private-fixture-room' }));
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
  await store.syncRoom(actors[0].roomId, actors.map(actor => ({ ...actor, connected: true, available: true })), now);
  const command = (side: number, request: PvpRequest) => store.command(actors[side], request, ++now);
  const created = await command(0, { id: randomUUID(), action: 'create', gameId, stakeUnits: '10000000', targetId: actors[1].accountId });
  const matchId = created.active!.id;
  await command(1, { id: randomUUID(), action: 'accept', challengeId: matchId });
  await command(0, { id: randomUUID(), action: 'ready', challengeId: matchId });
  const started = await command(1, { id: randomUUID(), action: 'ready', challengeId: matchId });
  assert.equal(started.active?.status, 'playing');
  return { actors, scope, match: started.active!, audit, game, command,
    settle: (winnerId: string, reason: 'win') => store.adjudicate(actors[0].roomId, matchId, winnerId, reason, ++now),
    now: () => now,
    persist: (recording: CapturedSportReplay) => persistCapturedSportReplay(audit, scope, game.schema, recording),
    read: () => new AuditReplayStore(audit).read(scope, matchId, sportReplayDefinitions),
  };
}

test('hockey reproduces a complete real engine win and links the two holds and one paid award in its dataset', async t => {
  const f = await fixture(t, 'hockey');
  const { engine, capture, recordings } = tableCapture(f.match);
  engine.move('unknown seat', 10, 10);
  engine.move(sessions[0], Infinity, 100);
  engine.move(sessions[1], 999, 10);
  let tick = 0;
  let expectedSeek: SportReplayFrame | undefined;
  for (; tick < 7000 && engine.state.phase === 'playing'; tick++) {
    const puck = engine.state.balls[0];
    engine.move(sessions[0], Math.min(180, puck.x - 30), puck.y + (puck.y > 200 ? 5 : -5));
    engine.tick(tick % 2 ? .05 : .047);
    if (tick === 200) expectedSeek = sportReplayFrame(engine.state, tick + 1);
  }
  assert.equal(engine.state.winner, sessions[0]);
  assert.deepEqual(engine.state.score, [7, 0]);
  await f.settle(f.actors[0].accountId, 'win');
  capture.observeAdjudication(f.match.id, f.actors[0].accountId, 'win', f.now());
  capture.observeAdjudication(f.match.id, f.actors[0].accountId, 'win', f.now());
  assert.equal(recordings.length, 1);
  const [recording] = recordings;
  assert.equal(await persistCapturedSportReplay(f.audit, { ...f.scope, datasetId: randomUUID() }, f.game.schema, recording), 'not-captured');
  assert.equal(await persistCapturedSportReplay(f.audit, { ...f.scope, environment: 'live' }, f.game.schema, recording), 'not-captured');
  assert.equal(await f.persist(recording), 'recorded');
  assert.equal(await f.persist(recording), 'replayed');
  const read = await f.read();
  assert.equal(read.status, 'verified');
  if (read.status !== 'verified') throw new Error('Replay was not stored');
  const pack = read.value;
  assert.equal(pack.manifest.formatVersion, 4);
  assert.equal(pack.manifest.coverage, 'complete');
  const events = pack.fragments.flatMap(fragment => fragment.events);
  assert.deepEqual(events[1].data, { kind: 'action', action: { profile: 'pvp-sport', code: 'paddle', seat: 2, x: 666, y: 54 } });
  assert.deepEqual(events[0].money?.map(leg => leg.units), ['-1000', '-1000']);
  assert.deepEqual(events.at(-1)?.money?.map(leg => leg.units), ['1900']);
  assert.equal(events.at(-1)?.data.kind, 'terminal');
  const terminal = events.at(-1)!.data;
  if (terminal.kind !== 'terminal') throw new Error('Terminal missing');
  assert.equal(terminal.winnerSeat, 1);
  assert.deepEqual(reconstructSportReplay(pack, 201), { status: 'verified', state: expectedSeek });
  assert.deepEqual(reconstructSportReplay(pack, tick + 1), { status: 'incomplete' });
  assert.deepEqual(reconstructSportReplay(pack), { status: 'verified', state: terminal.state });
  const serialized = JSON.stringify(pack);
  assert.ok(f.actors.every(actor => !serialized.includes(actor.accountId) && !serialized.includes(actor.name) && !serialized.includes(actor.roomId)));
  assert.ok(sessions.every(session => !serialized.includes(session)));
});

test('pool accepts only the actual shot and cue placement, then records a genuine wallet forfeit', async t => {
  const f = await fixture(t, 'pool');
  const { engine, capture, recordings } = tableCapture(f.match);
  assert.equal(engine.shoot(sessions[1], Math.PI, 80), false);
  assert.equal(engine.place(sessions[0], 180, 180), false);
  assert.equal(engine.shoot(sessions[0], Math.PI, 17, 5), true);
  assert.equal(engine.shoot(sessions[0], 0, 100), false);
  for (let i = 0; i < 120 && engine.state.moving; i++) engine.tick(i % 2 ? .06 : .05);
  assert.equal(engine.state.ballInHand, 'kitchen');
  assert.equal(engine.place(sessions[1], 400, 180), false);
  assert.equal(engine.place(sessions[1], 180, 180), true);
  capture.observePresence(sessions[1], 'disconnected');
  capture.observePresence(sessions[1], 'disconnected');
  capture.observePresence(sessions[1], 'reconnected');
  engine.tick(.018337);
  const requestId = randomUUID();
  const ended = await f.command(1, { id: requestId, action: 'resign', challengeId: f.match.id });
  assert.equal(ended.active?.reason, 'resign');
  capture.observeTerminal(ended.active!, f.actors[1].accountId);
  assert.equal(await f.persist(recordings[0]), 'recorded');
  const read = await f.read();
  if (read.status !== 'verified') throw new Error('Replay was not stored');
  const { value: pack } = read;
  assert.equal(pack.manifest.coverage, 'complete');
  const events = pack.fragments.flatMap(fragment => fragment.events);
  const controls = events.flatMap(event => event.data.kind === 'action' && event.data.action.code !== 'advance' ? [event.data.action] : []);
  assert.deepEqual(controls, [
    { profile: 'pvp-sport', code: 'shot', seat: 1, angle: Math.PI, power: 80, pocket: 5 },
    { profile: 'pvp-sport', code: 'place', seat: 2, x: 180, y: 180 },
    { profile: 'pvp-sport', code: 'resign', seat: 2 },
  ]);
  assert.deepEqual(events.flatMap(event => event.data.kind === 'presence' ? [event.data.event] : []), ['disconnected', 'reconnected']);
  assert.deepEqual(events[0].money?.map(leg => leg.units), ['-1000', '-1000']);
  assert.deepEqual(events.at(-1)?.money?.map(leg => leg.units), ['1900']);
  const terminal = events.at(-1)?.data;
  assert.equal(terminal?.kind === 'terminal' && terminal.outcome, 'forfeited');
  assert.equal(reconstructSportReplay(pack).status, 'verified');
  assert.ok(!JSON.stringify(pack).includes(requestId));

  const falsified = structuredClone(events);
  const shot = falsified[1].data;
  if (shot.kind !== 'action' || shot.action.code !== 'shot') throw new Error('Expected captured shot');
  shot.action.seat = 2;
  const { sha256: _sha, terminal: _terminal, fragments: _fragments, ...manifest } = pack.manifest;
  const selfConsistent = createReplayPackage(manifest, falsified);
  assert.equal(verifyReplayPackage(selfConsistent).status, 'verified');
  let frames = 0;
  assert.equal(reconstructSportReplay(selfConsistent, undefined, () => { frames++; }).status, 'corrupt');
  assert.equal(frames, 0);
  assert.throws(() => createReplayPackage({ ...manifest, formatVersion: 3 }, events), /Invalid replay evidence/);
  const leaked = structuredClone(events);
  Object.assign(leaked[1].data, { session: sessions[0] });
  assert.throws(() => createReplayPackage(manifest, leaked), /Invalid replay evidence/);
});

test('a durable pool award without observed physics end does not invent an exact cutoff', async t => {
  const f = await fixture(t, 'pool');
  const { engine, capture, recordings } = tableCapture(f.match);
  for (let i = 0; i < 120; i++) engine.tick(.016667);
  assert.ok(capture.observeAdjudicationStart(f.match.id));
  for (let i = 0; i < 10; i++) engine.tick(.016667);
  const acceptHandoff = capture.observeAdjudicationStart(f.match.id);
  assert.ok(acceptHandoff);
  const settled = f.settle(f.actors[1].accountId, 'win');
  for (let i = 0; i < 15; i++) engine.tick(.016667);
  await settled;
  acceptHandoff();
  capture.observeAdjudication(f.match.id, f.actors[1].accountId, 'win', f.now());
  assert.deepEqual(recordings[0].gaps, ['terminal-unavailable']);
  assert.equal(await f.persist(recordings[0]), 'recorded');
  const read = await f.read();
  if (read.status !== 'verified') throw new Error('Partial replay was not stored');
  assert.equal(read.value.manifest.coverage, 'partial');
  assert.equal(read.value.manifest.terminal, null);
  const reconstructed = reconstructSportReplay(read.value);
  assert.equal(reconstructed.status === 'verified' && reconstructed.state?.tick, 130);
  const events = read.value.fragments.flatMap(fragment => fragment.events);
  assert.deepEqual(events.flatMap(event => event.money?.map(leg => leg.movement) ?? []), ['reserve', 'reserve']);
  assert.equal(events.some(event => event.data.kind === 'terminal'), false);
  const mismatched = buildSportReplay({ ...recordings[0], gaps: ['terminal-unavailable', 'event-gap'] }, f.scope, { sourceGap: true });
  assert.deepEqual(mismatched.manifest.gaps, ['terminal-unavailable', 'event-gap', 'source-unavailable']);
});

test('the paid LobbyRoom pool deadline records an observed idle terminal and exactly one payout', {
  skip: process.env.NODE_ENV !== 'test',
}, async t => {
  const [{ LobbyRoom, configureLobbyPvpReplays }, { accounts }] = await Promise.all([
    import('../server/LobbyRoom'), import('../server/accounts'),
  ]);
  await accounts.ready;
  const game = new PostgresDatabase(accounts.schema, { existingSchema: true });
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close(), accounts.close()]); });
  const logins = await Promise.all([0, 1].map(async seat => {
    const login = await accounts.login('pool-idle-' + seat + '-' + randomUUID() + '@example.test', 'test-password-only');
    await accounts.select(login.account.id, 0);
    await accounts.wallet.operate(login.account.id, { id: randomUUID(), kind: 'deposit', amount: 10 });
    return login;
  }));
  const { datasetId, environment } = await new AuditDatasets(audit, { game: accounts.schema }).startTest();
  const scope = { datasetId, environment };
  const records: CapturedSportReplay[] = [];
  configureLobbyPvpReplays({ recordSport: record => records.push(record) });
  const room = new LobbyRoom();
  room.roomId = 'pool-audit-' + randomUUID();
  const messages = new Map<string, (client: unknown, value: unknown) => unknown>();
  t.mock.method(room, 'onMessage', (name: string, listener: (client: unknown, value: unknown) => unknown) => messages.set(name, listener));
  t.mock.method(room, 'setPatchRate', () => {});
  t.mock.method(room, 'setSimulationInterval', () => {});
  t.mock.method(room, 'broadcast', () => {});
  t.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  t.after(() => { configureLobbyPvpReplays(); room.onDispose(); room.clock.clear(); });
  room.onCreate();
  const clients = await Promise.all(logins.map(async (login, index) => {
    const auth = (await accounts.session(login.token))!;
    const replies = new Map<string, { type: string; active?: PvpChallenge }>();
    const client = { sessionId: sessions[index], auth, leave() {},
      send(type: string, value: { requestId?: string; active?: PvpChallenge } | null) {
        if (value?.requestId) replies.set(value.requestId, { type, active: value.active });
      } };
    await room.onJoin(client as never, { activityProtocol: 1 }, auth);
    room.clients.push(client as never);
    Object.assign(room.state.players.get(client.sessionId)!, { hall: 'tables', ...pvpSeat('pool', index) });
    return { client, replies };
  }));
  await accounts.pvp.syncRoom(room.roomId, logins.map(({ account }) => ({
    accountId: account.id, name: account.name, connected: true, available: true,
  })));
  const command = async (seat: number, request: Record<string, unknown>) => {
    const id = randomUUID();
    await messages.get('pvp')!(clients[seat].client, { ...request, id, walletScope: VIRTUAL_PVP_SCOPE });
    const reply = clients[seat].replies.get(id);
    assert.equal(reply?.type, 'pvp');
    assert(reply?.active);
    return reply.active;
  };
  const { id: matchId } = await command(0, { action: 'create', gameId: 'pool', stakeUnits: '1000000', targetId: null });
  await command(1, { action: 'accept', challengeId: matchId });
  await command(0, { action: 'ready', challengeId: matchId });
  const playing = await command(1, { action: 'ready', challengeId: matchId });
  assert.equal(playing.status, 'playing');
  const [creator, opponent] = logins.map(({ account }) => account.id);
  const invalid = await virtualPvpCommand(accounts.pvp)(creator, 'pvp-result', {
    roomId: room.roomId, matchId, winnerId: opponent, reason: 'timeout', idleForMs: POOL_IDLE_TIMEOUT_MS,
  });
  assert.equal(invalid.status, 400);

  const pvp = Reflect.get(room, 'pvp') as { sync(): Promise<void>; poolTurn?: { at: number } };
  assert(pvp.poolTurn);
  const startedAt = pvp.poolTurn.at;
  let wallClock = startedAt;
  const clock = t.mock.method(Date, 'now', () => wallClock);
  try {
    // Keep the room lease fresh while testing the unchanged wall-clock cutoff.
    for (let elapsed = 10_000; elapsed <= POOL_IDLE_TIMEOUT_MS; elapsed += 10_000) {
      wallClock = startedAt + elapsed;
      await pvp.sync();
    }
    assert.equal(records.length, 0);
    wallClock++;
    await pvp.sync();
    await pvp.sync();
  } finally { clock.mock.restore(); }

  assert.equal(records.length, 1);
  assert.deepEqual(records[0].gaps, []);
  assert.equal(records[0].settlement.reason, 'timeout');
  const bank = await game.prepare('SELECT winner_id,reason,fee_units FROM virtual_pvp_banks WHERE match_id=?').get(matchId);
  assert.deepEqual(bank, { winner_id: opponent, reason: 'timeout', fee_units: 10 });
  const final = await game.prepare("SELECT account_id,amount_units FROM demo_ledger WHERE operation_id=? AND entry_type='win'")
    .all('pvp:' + matchId + ':final');
  assert.deepEqual(final, [{ account_id: opponent, amount_units: 190 }]);
  assert.equal(await persistCapturedSportReplay(audit, scope, accounts.schema, records[0]), 'recorded');
  const stored = await new AuditReplayStore(audit).read(scope, matchId, sportReplayDefinitions);
  assert.equal(stored.status, 'verified');
  const pack = stored.value;
  assert.equal(pack.manifest.formatVersion, 5);
  assert.equal(pack.manifest.coverage, 'complete');
  const events = pack.fragments.flatMap(fragment => fragment.events);
  const terminal = events.at(-1);
  assert(terminal?.data.kind === 'terminal' && terminal.data.state.profile === 'pvp-sport');
  const terminalData = terminal.data;
  assert.equal(terminal.data.outcome, 'timed-out');
  assert.equal(terminal.data.idleForMs, POOL_IDLE_TIMEOUT_MS + 1);
  assert.equal(terminal.data.winnerSeat, 2);
  assert.equal(terminal.data.state.moving, false);
  assert.equal(terminal.data.state.turn, 1);
  assert.deepEqual(terminal.money?.map(leg => [leg.movement, leg.units]), [['payout', '190']]);
  assert.equal(prepareViewerReplay(pack).status, 'ready');

  const { sha256: _sha, terminal: _terminal, fragments: _fragments, ...manifest } = pack.manifest;
  const beforeTerminal = events.slice(0, -1);
  assert.throws(() => createReplayPackage(manifest, [...beforeTerminal,
    { ...terminal, data: { ...terminalData, idleForMs: POOL_IDLE_TIMEOUT_MS } }]), /Invalid replay evidence/);
  const wrongWinner = createReplayPackage(manifest, [...beforeTerminal, { ...terminal, data: { ...terminalData, winnerSeat: 1 } }]);
  assert.equal(reconstructSportReplay(wrongWinner).status, 'corrupt');

  const withoutHandoff = tableCapture(playing);
  withoutHandoff.capture.observeAdjudication(matchId, opponent, 'timeout', wallClock);
  const partial = buildSportReplay(withoutHandoff.recordings[0], scope);
  assert.equal(partial.manifest.formatVersion, 4);
  assert.deepEqual(partial.manifest.gaps, ['terminal-unavailable']);
  assert.equal(partial.manifest.terminal, null);
});

test('installing a throwing observer leaves accepted physics, move and return values unchanged', () => {
  const ordinary = new TableGame('pool'), observed = new TableGame('pool');
  observed.setReplayObserver(() => { throw new Error('observer failed'); });
  for (const game of [ordinary, observed]) {
    assert.equal(game.join('a'), true); assert.equal(game.join('b'), true);
    assert.equal(game.shoot('a', .13, 850), true);
    for (let i = 0; i < 150; i++) game.tick(i % 2 ? .013 : .023);
  }
  assert.deepEqual(ordinary.state, observed.state);
});
