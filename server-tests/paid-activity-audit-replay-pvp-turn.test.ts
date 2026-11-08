import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CHESS_TIME_MS } from '../src/shared/activities';
import type { PvpChallenge } from '../src/shared/pvp';
import { ChessGame } from '../server/chessGame';
import { buildChessTurnReplay, ChessTurnReplayCapture, verifyChessTurnReplay,
  type CapturedChessReplay } from '../server/audit/replay-pvp-turn';
import { createReplayPackage, type ReplayEvent } from '../server/audit/replay-package';
import { isAuditRecord } from '../server/audit/contract';
import { prepareViewerReplay } from '../src/audit/replay-viewer-model';

const white = 'white-session-secret';
const black = 'black-session-secret';
const whiteAccount = randomUUID();
const blackAccount = randomUUID();
const scope = { datasetId: randomUUID(), environment: 'test' } as const;

function setup(options: { bind?: boolean; reversed?: boolean } = {}) {
  const match: PvpChallenge = {
    id: randomUUID(), gameId: 'chess', creatorId: whiteAccount, opponentId: blackAccount, targetId: null,
    creatorName: 'private-white', opponentName: 'private-black', stakeUnits: '1000000', potUnits: '2000000',
    feeUnits: '100000', payoutUnits: '1900000', status: 'playing', createdAt: 1, expiresAt: 999,
    ready: [whiteAccount, blackAccount], winnerId: null, reason: '', revision: 1, disconnected: [],
  };
  let now = 10;
  const records: CapturedChessReplay[] = [];
  const chess = new ChessGame(undefined, () => now);
  const capture = new ChessTurnReplayCapture(session => session === white ? whiteAccount : session === black ? blackAccount : undefined,
    recording => records.push(recording), () => now);
  chess.setReplayObserver(event => capture.observeEngine(event));
  if (options.bind !== false) capture.observeMatches([match]);
  for (const session of options.reversed ? [black, white] : [white, black]) assert.equal(chess.join(session), true);
  const advance = (ms = 10) => { now += ms; };
  const move = (session: string, from: string, to: string, promotion?: string) => {
    advance();
    return chess.move(session, from, to, promotion);
  };
  const settle = (winner: string | null, reason: 'win' | 'draw') => capture.observeAdjudication(match.id, winner, reason, 5000);
  return { match, chess, capture, records, advance, move, settle };
}

function result(records: CapturedChessReplay[], links?: Parameters<typeof buildChessTurnReplay>[2]) {
  assert.equal(records.length, 1);
  const replay = buildChessTurnReplay(records[0], scope, links);
  assert.equal(verifyChessTurnReplay(replay).status, 'verified');
  return { replay, events: replay.fragments.flatMap(fragment => fragment.events) };
}

test('captures server-accepted chess moves, reconnect and checkmate in order without session details', () => {
  const { chess, capture, records, advance, move, settle } = setup();
  assert.equal(move(black, 'e7', 'e5'), false);
  assert.equal(move(white, 'a2', 'a5'), false);
  assert.equal(move(white, 'f2', 'f3'), true);
  assert.equal(move(white, 'f2', 'f3'), false);
  advance();
  capture.observePresence(black, 'disconnected');
  capture.observePresence(black, 'disconnected');
  advance();
  capture.observePresence('another-session', 'reconnected');
  capture.observePresence(black, 'reconnected');
  assert.equal(move(black, 'e7', 'e5'), true);
  assert.equal(move(white, 'g2', 'g4'), true);
  assert.equal(move(black, 'd8', 'h4'), true);
  assert.equal(chess.state.winner, black);
  assert.equal(records.length, 0);
  advance(100);
  settle(blackAccount, 'win');
  settle(blackAccount, 'win');

  const start = { namespace: 'test_game.demo_ledger', rowId: '10' };
  const terminal = { namespace: 'test_game.demo_ledger', rowId: '20' };
  const { replay, events } = result(records, { startMoney: [{ posting: start, units: '-100', movement: 'reserve' }],
    terminalMoney: [{ posting: terminal, units: '190', movement: 'payout' }] });
  assert.equal(replay.manifest.coverage, 'complete');
  assert.equal(replay.manifest.formatVersion, 2);
  assert.deepEqual(events.map(event => event.data.kind), ['checkpoint', 'action', 'presence', 'presence', 'action', 'action', 'action', 'terminal']);
  assert.deepEqual(events.filter(event => event.data.kind === 'presence').map(event => event.data),
    [{ kind: 'presence', seat: 2, event: 'disconnected' }, { kind: 'presence', seat: 2, event: 'reconnected' }]);
  assert.deepEqual(events[0].postings, [start]);
  assert.deepEqual(events.at(-1)?.postings, [terminal]);
  assert.equal(events.at(-1)?.atMs, events.at(-2)?.atMs);
  const end = events.at(-1)?.data;
  assert.equal(end?.kind === 'terminal' && end.winnerSeat, 2);
  const wire = JSON.stringify(replay);
  for (const secret of [white, black, whiteAccount, blackAccount, 'private-white', 'private-black']) assert(!wire.includes(secret));
});

test('replays repeated positions as an engine draw from the original turn history', () => {
  const { chess, records, move, settle } = setup();
  for (let cycle = 0; cycle < 2; cycle++) {
    assert.equal(move(white, 'g1', 'f3'), true);
    assert.equal(move(black, 'g8', 'f6'), true);
    assert.equal(move(white, 'f3', 'g1'), true);
    assert.equal(move(black, 'f6', 'g8'), true);
  }
  assert.equal(chess.state.phase, 'finished');
  settle(null, 'draw');
  const { events } = result(records);
  const end = events.at(-1)?.data;
  assert.equal(end?.kind === 'terminal' && end.outcome, 'draw');
});

test('late chess capture shows the first observed ply and the real suffix without engine verification', () => {
  const { chess, match, capture, records, move, settle } = setup({ bind: false });
  assert.equal(move(white, 'f2', 'f3'), true);
  assert.equal(move(black, 'e7', 'e5'), true);
  capture.observeMatches([match]);
  assert.equal(move(white, 'g2', 'g4'), true);
  assert.equal(move(black, 'd8', 'h4'), true);
  assert.equal(chess.state.winner, black);
  settle(blackAccount, 'win');
  assert.equal(records.length, 1);

  const reserve = { namespace: 'test_game.demo_ledger', rowId: '10' };
  const payout = { namespace: 'test_game.demo_ledger', rowId: '20' };
  const replay = buildChessTurnReplay(records[0], scope, {
    startMoney: [{ posting: reserve, units: '-100', movement: 'reserve' }],
    terminalMoney: [{ posting: payout, units: '190', movement: 'payout' }],
  });
  const { manifest, fragments } = replay;
  assert.equal(manifest.coverage, 'partial');
  assert.equal(manifest.initial, null);
  assert.deepEqual(manifest.gaps, ['initial-state-unavailable', 'event-gap']);
  const events = fragments.flatMap(fragment => fragment.events);
  const firstBoard = events.find(event => event.data.kind === 'checkpoint');
  assert(firstBoard?.data.kind === 'checkpoint' && firstBoard.data.state.profile === 'pvp-turn-based');
  assert.equal(firstBoard.atMs, 0);
  assert.equal(firstBoard.data.state.turn, 3);
  assert.equal(firstBoard.data.state.seatToMove, 2);
  assert.equal(firstBoard.data.state.board[30], 1);
  assert.deepEqual(firstBoard.postings, []);
  assert(events.every(event => event.postings.every(posting => posting.rowId !== reserve.rowId)));
  const moves = events.flatMap(({ data }) => data.kind === 'action' && data.action.profile === 'pvp-turn-based'
    ? [data.action.positions] : []);
  assert.deepEqual(moves, [[14, 30], [59, 31]]);

  const last = events.at(-1);
  assert(last?.data.kind === 'terminal' && last.data.state.profile === 'pvp-turn-based');
  assert.equal(last.data.state.turn, 4);
  assert.equal(last.data.outcome, 'settled');
  assert.equal(last.data.winnerSeat, 2);
  assert.deepEqual(last.postings, [payout]);
  assert.equal(verifyChessTurnReplay(replay).status, 'verified');
  const viewer = prepareViewerReplay(replay);
  assert.equal(viewer.status, 'ready');
  assert.equal(viewer.engineVerified, false);
  assert.equal(viewer.frames[0].state, null);
  assert.deepEqual(viewer.frames.find(frame => frame.sequence === firstBoard.sequence)?.state, firstBoard.data.state);

  const unsupported = createReplayPackage({ formatVersion: 2, scope, replayId: manifest.replayId, entityId: manifest.entityId,
    game: { ...manifest.game, engineVersion: 'unknown-version' }, initial: null, coverage: 'partial', gaps: manifest.gaps }, events);
  assert.equal(verifyChessTurnReplay(unsupported).status, 'unsupported');
  assert.equal(prepareViewerReplay(unsupported).status, 'unsupported');
  const wrongPly = createReplayPackage({ formatVersion: 2, scope, replayId: manifest.replayId, entityId: manifest.entityId,
    game: manifest.game, initial: null, coverage: 'partial', gaps: manifest.gaps }, events.map(event =>
    event.data.kind === 'checkpoint' && event.data.state.profile === 'pvp-turn-based'
      ? { ...event, data: { ...event.data, state: { ...event.data.state, turn: event.data.state.turn + 2 } } } : event));
  assert.equal(verifyChessTurnReplay(wrongPly).status, 'corrupt');
  assert.equal(prepareViewerReplay(wrongPly).status, 'corrupt');
});

test('distinguishes actual clock timeout from the rejected late move and rejects a forged early timeout', () => {
  const { chess, records, advance, settle } = setup();
  advance(CHESS_TIME_MS);
  assert.equal(chess.move(white, 'e2', 'e4', undefined), false);
  settle(blackAccount, 'win');
  const { replay, events } = result(records);
  assert.equal(events.length, 2);
  assert.equal(events[1].atMs, CHESS_TIME_MS);
  assert.equal(events[1].data.kind === 'terminal' && events[1].data.outcome, 'timed-out');
  const { manifest } = replay;
  const forged = createReplayPackage({ formatVersion: 2, game: manifest.game, initial: manifest.initial,
    scope: manifest.scope, replayId: manifest.replayId, entityId: manifest.entityId, coverage: 'complete', gaps: [] },
    [events[0], { ...events[1], atMs: 1 }]);
  assert.equal(verifyChessTurnReplay(forged).status, 'corrupt');
});

test('captures engine resignation, confirmed paid resignation and disconnect adjudication separately', () => {
  const inGame = setup();
  inGame.advance();
  assert.equal(inGame.chess.resign(black), true);
  inGame.settle(whiteAccount, 'win');
  const { events: engineEvents } = result(inGame.records);
  assert.deepEqual(engineEvents[1].data, { kind: 'action', action: { profile: 'pvp-turn-based', code: 'resign', seat: 2, positions: [] } });

  const paid = setup();
  paid.capture.observeTerminal({ ...paid.match, status: 'finished', reason: 'resign', winnerId: blackAccount }, whiteAccount);
  const { events: paidEvents } = result(paid.records);
  assert.deepEqual(paidEvents[1].data, { kind: 'action', action: { profile: 'pvp-turn-based', code: 'resign', seat: 1, positions: [] } });
  assert.equal(paidEvents[2].data.kind === 'terminal' && paidEvents[2].data.outcome, 'forfeited');

  const disconnected = setup();
  disconnected.advance();
  disconnected.capture.observePresence(white, 'disconnected');
  disconnected.capture.observeMatches([], [{ ...disconnected.match, status: 'finished', reason: 'disconnect', winnerId: blackAccount }]);
  const { events: disconnectEvents } = result(disconnected.records);
  assert.equal(disconnectEvents[1].data.kind, 'presence');
  assert.equal(disconnectEvents[2].data.kind === 'terminal' && disconnectEvents[2].data.outcome, 'forfeited');
});

test('does not synthesize missing actions, unaffiliated play or unsupported rules from state', () => {
  for (const options of [{ bind: false }, { reversed: true }]) {
    const played = setup(options);
    assert.equal(played.chess.resign(white), true);
    played.settle(blackAccount, 'win');
    assert.deepEqual(played.records, []);
  }
  const missing = setup();
  missing.capture.observeTerminal({ ...missing.match, status: 'finished', reason: 'resign', winnerId: blackAccount });
  const { replay, events } = result(missing.records, { sourceGap: true });
  assert.deepEqual(replay.manifest.gaps, ['event-gap', 'terminal-unavailable', 'source-unavailable']);
  assert.deepEqual(events.map(event => event.data.kind), ['checkpoint']);

  const { game, initial, replayId, entityId } = replay.manifest;
  const forged: ReplayEvent = { sequence: 2, atMs: 3, postings: [],
    data: { kind: 'action', action: { profile: 'pvp-turn-based', code: 'move', seat: 2, positions: [52, 36] } } };
  const invalid = createReplayPackage({ formatVersion: 2, game, initial, replayId, entityId, scope,
    coverage: 'partial', gaps: ['terminal-unavailable'] }, [events[0], forged]);
  assert.equal(verifyChessTurnReplay(invalid).status, 'corrupt');
  const unsupported = createReplayPackage({ formatVersion: 2, game: { ...game, engineVersion: 'unknown-version' },
    initial, replayId, entityId, scope, coverage: 'partial', gaps: ['terminal-unavailable'] }, [events[0]]);
  assert.equal(verifyChessTurnReplay(unsupported).status, 'unsupported');
});

test('a throwing observer cannot alter legal move, resignation or timeout results', () => {
  const { chess, advance } = setup();
  chess.setReplayObserver(() => { throw Error('audit sink unavailable'); });
  assert.equal(chess.move(white, 'e2', 'e4', undefined), true);
  assert.equal(chess.state.turn, 'b');
  advance(CHESS_TIME_MS);
  assert.equal(chess.resign(black), false);
  assert.equal(chess.state.winner, white);

  const resigned = setup();
  resigned.chess.setReplayObserver(() => { throw Error('audit sink unavailable'); });
  assert.equal(resigned.chess.resign(white), true);
  assert.equal(resigned.chess.state.winner, black);
});

test('an engine revision gap survives return to the original board', () => {
  const { chess, capture, records, move, settle } = setup();
  chess.setReplayObserver(undefined);
  for (const [actor, from, to] of [[white, 'g1', 'f3'], [black, 'g8', 'f6'], [white, 'f3', 'g1'], [black, 'f6', 'g8']]) {
    assert.equal(move(actor, from, to), true);
  }
  chess.setReplayObserver(event => capture.observeEngine(event));
  assert.equal(move(white, 'e2', 'e4'), true);
  assert.equal(chess.resign(black), true);
  settle(whiteAccount, 'win');
  const { replay, events } = result(records);
  assert.deepEqual(replay.manifest.gaps, ['event-gap', 'terminal-unavailable']);
  assert.deepEqual(events.map(event => event.data.kind), ['checkpoint']);
});

test('records the actual promotion piece in the accepted move', () => {
  const { chess, records, move, settle } = setup();
  for (const [actor, from, to] of [
    [white, 'a2', 'a4'], [black, 'h7', 'h5'], [white, 'a4', 'a5'], [black, 'h5', 'h4'],
    [white, 'a5', 'a6'], [black, 'h4', 'h3'], [white, 'a6', 'b7'], [black, 'h3', 'g2'],
  ]) assert.equal(move(actor, from, to), true);
  assert.equal(move(white, 'b7', 'a8', 'n'), true);
  assert.equal(chess.resign(black), true);
  settle(whiteAccount, 'win');
  const { events } = result(records);
  assert.deepEqual(events[9].data, { kind: 'action', action: { profile: 'pvp-turn-based', code: 'move', seat: 1, positions: [49, 56, 4] } });
});

test('paid chess and v4 duels record real LobbyRoom matches with settled scoped replays', {
  skip: process.env.NODE_ENV !== 'test',
}, async t => {
  const [{ LobbyRoom, configureLobbyChessReplay, configureLobbyPvpReplays }, { accounts }, { PostgresDatabase }, { AuditDatasets },
    { AuditReplayStore }, { chessReplayWriter, persistCapturedChessReplay }, { pvpSeat }] = await Promise.all([
    import('../server/LobbyRoom'), import('../server/accounts'), import('../server/database'), import('../server/audit/datasets'),
    import('../server/audit/replay-store'), import('../server/audit/replay-chess-storage'), import('../src/shared/pvpSeats'),
  ]);
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), accounts.close()]); });
  await accounts.ready;
  const source = new PostgresDatabase(accounts.schema, { existingSchema: true });
  t.after(() => source.close());
  const logins = await Promise.all([0, 1].map(seat => accounts.login('chess-replay-' + seat + '-' + randomUUID() + '@example.test', 'test-password-only')));
  await Promise.all(logins.map(async login => {
    await accounts.select(login.account.id, 0);
    await accounts.wallet.operate(login.account.id, { id: randomUUID(), kind: 'deposit', amount: 10 });
  }));
  const dataset = await new AuditDatasets(audit, { game: accounts.schema }).startTest();
  const observed: CapturedChessReplay[] = [];
  let settle!: (recording: CapturedChessReplay | null) => void;
  const finished = new Promise<CapturedChessReplay | null>(resolve => { settle = resolve; });
  configureLobbyChessReplay(recording => { observed.push(recording); settle(recording); });
  const tsu: import('../server/audit/replay-pvp-tsu').CapturedTsuReplay[] = [];
  configureLobbyPvpReplays({ recordTsu: recording => tsu.push(recording) });
  const room = new LobbyRoom();
  room.roomId = 'chess-audit-' + randomUUID();
  const messages = new Map<string, (client: any, message: any) => unknown>();
  const intervals: (() => void)[] = [];
  t.mock.method(room, 'onMessage', (type: string, listener: (client: any, message: any) => unknown) => messages.set(type, listener));
  t.mock.method(room, 'setPatchRate', () => {});
  t.mock.method(room, 'setSimulationInterval', () => {});
  t.mock.method(room, 'broadcast', () => {});
  t.mock.method(room.clock, 'setInterval', (callback: () => void) => { intervals.push(callback); return { clear() {} }; });
  t.after(() => { configureLobbyChessReplay(undefined); configureLobbyPvpReplays(); room.onDispose(); room.clock.clear(); });
  room.onCreate();

  const clients = await Promise.all(logins.map(async (login, index) => {
    const auth = (await accounts.session(login.token))!;
    const sent: { type: string; value: any }[] = [];
    const client = { sessionId: 'fixture-chess-' + index, auth,
      send: (type: string, value: unknown) => sent.push({ type, value }), leave: () => {} };
    await room.onJoin(client as never, { activityProtocol: 1 }, auth);
    room.clients.push(client as never);
    Object.assign(room.state.players.get(client.sessionId)!, { hall: 'tables', ...pvpSeat('chess', index) });
    return { client, sent };
  }));
  await accounts.pvp.syncRoom(room.roomId, logins.map(login => ({
    accountId: login.account.id, name: login.account.name, connected: true, available: true,
  })));
  const command = async (seat: number, request: Record<string, unknown>) => {
    const id = randomUUID();
    await messages.get('pvp')!(clients[seat].client, { ...request, id, walletScope: 'virtual-usdt-v1' });
    const response = clients[seat].sent.find(packet => packet.value?.requestId === id);
    assert.equal(response?.type, 'pvp', JSON.stringify(response?.value?.error));
    return response?.value.active as PvpChallenge;
  };
  const created = await command(0, { action: 'create', gameId: 'chess', stakeUnits: '1000000', targetId: null });
  await command(1, { action: 'accept', challengeId: created.id });
  await command(0, { action: 'ready', challengeId: created.id });
  assert.equal((await command(1, { action: 'ready', challengeId: created.id })).status, 'playing');
  const moves = [[0, 'f2', 'f3'], [1, 'e7', 'e5'], [0, 'g2', 'g4'], [1, 'd8', 'h4']] as const;
  for (const [seat, from, to] of moves) {
    await messages.get('activity')!(clients[seat].client, { type: 'chess-move', from, to });
  }
  assert.equal(observed.length, 0);
  const wait = setTimeout(() => settle(null), 3000);
  intervals[1]();
  const recording = await finished;
  clearTimeout(wait);
  assert.ok(recording, 'pvp room must deliver its authoritative settlement');
  assert.equal(recording.matchId, created.id);
  assert.deepEqual(recording.gaps, []);
  assert.equal(recording.settlement.winnerSeat, 2);
  const row = await source.prepare('SELECT winner_id,reason,fee_units FROM virtual_pvp_banks WHERE match_id=?').get(created.id);
  assert.deepEqual(row, { winner_id: logins[1].account.id, reason: 'win', fee_units: 10 });
  assert.equal((await accounts.wallet.snapshot(logins[0].account.id)).balance, 9);
  assert.equal((await accounts.wallet.snapshot(logins[1].account.id)).balance, 10.9);

  const storageScope = { datasetId: dataset.datasetId, environment: 'test' } as const;
  await t.test('a failed manifest write records an idempotent scoped capture gap', async () => {
    await audit.exec(`CREATE FUNCTION reject_replay_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Fixture replay write failure'; END $$;
      CREATE TRIGGER reject_replay_manifest BEFORE INSERT ON audit_replay_packages
      FOR EACH ROW EXECUTE FUNCTION reject_replay_manifest()`);
    const writer = chessReplayWriter(audit, storageScope, accounts.schema);
    try {
      writer.record(recording);
      writer.record(recording);
      writer.record({ ...recording, matchId: randomUUID() });
      await writer.stop();
      const markers = await audit.prepare(`SELECT evidence_id,account_id,payload FROM audit_evidence
        WHERE dataset_id=? AND kind='replay'`).all(dataset.datasetId);
      assert.equal(markers.length, 1);
      const marker = markers[0];
      assert.equal(marker.evidence_id, 'capture-gap:' + recording.matchId);
      assert.equal(marker.account_id, null);
      assert(isAuditRecord(marker.payload) && marker.payload.type === 'replay');
      assert.equal(marker.payload.replayId, marker.evidence_id);
      assert.equal(marker.payload.coverage, 'not-recorded');
      assert.deepEqual(marker.payload.entity.source, { namespace: accounts.schema + '.pvp_matches', rowId: recording.matchId });
      assert.deepEqual(await new AuditReplayStore(audit).read(storageScope, recording.matchId), { status: 'not-found' });
    } finally {
      await writer.stop();
      await audit.exec('DROP TRIGGER reject_replay_manifest ON audit_replay_packages; DROP FUNCTION reject_replay_manifest()');
    }
  });
  assert.equal(await persistCapturedChessReplay(audit, storageScope, accounts.schema, recording), 'recorded');
  const verified = await new AuditReplayStore(audit).read(storageScope, recording.matchId);
  assert.equal(verified.status, 'verified');
  if (verified.status !== 'verified') return;
  assert.equal(verified.value.manifest.coverage, 'complete');
  const events = verified.value.fragments.flatMap(fragment => fragment.events);
  assert.equal(events[0].postings.length, 2);
  assert.equal(events.at(-1)?.postings.length, 1);
  assert.equal(events.at(-1)?.money?.[0]?.units, '190');
  assert.equal(verifyChessTurnReplay(verified.value).status, 'verified');

  const pvp = Reflect.get(room, 'pvp') as { queue: Promise<unknown>; sync(): Promise<void> };
  await pvp.queue;
  await pvp.sync();
  for (const { client } of clients) Object.assign(room.state.players.get(client.sessionId)!, { hall: 'tables', x: 460, y: 560 });
  await pvp.sync();
  const duel = await command(0, { action: 'invite', gameId: 'tsu-e-fa', stakeUnits: '100000', targetId: logins[1].account.id });
  await command(1, { action: 'accept', challengeId: duel.id });
  await command(0, { action: 'duel-ready', challengeId: duel.id, termsRevision: 0 });
  assert.equal((await command(1, { action: 'duel-ready', challengeId: duel.id, termsRevision: 0 })).status, 'playing');
  await command(0, { action: 'move', challengeId: duel.id, revision: 0, move: { kind: 'choose', round: 1, choice: 'scissors' } });
  await command(1, { action: 'resign', challengeId: duel.id });
  assert.equal(tsu.length, 1);
  assert.equal(tsu[0].settlement.reason, 'resign');
  assert.deepEqual(tsu[0].gaps, []);
  const { persistCapturedTsuReplay } = await import('../server/audit/replay-pvp-tsu-storage');
  assert.equal(await persistCapturedTsuReplay(audit, storageScope, accounts.schema, tsu[0]), 'recorded');
  const loaded = await new AuditReplayStore(audit).read(storageScope, duel.id);
  assert.equal(loaded.status, 'verified');
  if (loaded.status === 'verified') {
    const last = loaded.value.fragments.at(-1)?.events.at(-1);
    assert.ok(last?.data.kind === 'terminal' && last.data.state.profile === 'pvp-turn-based');
    assert.deepEqual(last.data.state.board.slice(5), [0, 0, 0, 0]);
    assert.equal(last.money?.[0]?.units, '19');
  }
});
