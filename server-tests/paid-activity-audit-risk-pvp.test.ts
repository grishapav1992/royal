import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditPostingReader } from '../server/audit/postings';
import { persistCapturedChessReplay } from '../server/audit/replay-chess-storage';
import { CardsTurnReplayCapture, type CapturedCardReplay } from '../server/audit/replay-pvp-cards';
import { persistCapturedCardReplay } from '../server/audit/replay-pvp-cards-storage';
import { TsuTurnReplayCapture } from '../server/audit/replay-pvp-tsu-capture';
import { persistCapturedTsuReplay } from '../server/audit/replay-pvp-tsu-storage';
import type { CapturedTsuReplay } from '../server/audit/replay-pvp-tsu';
import { ChessTurnReplayCapture, type CapturedChessReplay } from '../server/audit/replay-pvp-turn';
import { selectPvpRisk, pvpRiskRules } from '../server/audit/risk-pvp';
import { evaluateAuditRiskRule } from '../server/audit/risk-rules';
import { RISK_WINDOW_MS, type AuditRiskCandidate } from '../server/audit/risk-selection';
import { AuditRiskSignals, migrateAuditRiskSignals } from '../server/audit/risk-store';
import { readAuditRiskReportSignal, reviewAuditRiskReportSignal, runAuditRiskReport } from '../server/audit/risk-report';
import { ChessGame } from '../server/chessGame';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import type { PvpCardGameId, PvpRequest } from '../src/shared/pvp';

type TimedMode = PvpCardGameId | 'tsu-e-fa';

async function fixture(t: TestContext, count = 10) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const players = Array.from({ length: count }, (_, index) => ({
    accountId: randomUUID(), roomId: 'risk-pvp-fixture', name: 'Fixture ' + index, connected: true, available: true,
  }));
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  for (const player of players) await game.prepare('INSERT INTO accounts VALUES (?)').run(player.accountId);
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  for (const player of players) await wallet.operate(player.accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const ledger = new VirtualPvpLedger(game, wallet), store = new PvpStore(ledger);
  const combat = new NileCombatEscrow(ledger);
  const datasets = new AuditDatasets(audit, { game: game.schema });
  await Promise.all([store.ready, combat.ready, datasets.ready]);
  const dataset = await datasets.startTest();
  const scope = { datasetId: dataset.datasetId, environment: 'test' } as const;
  const fromMs = dataset.startedAtMs, toMs = fromMs + RISK_WINDOW_MS;
  let nextAt = fromMs + 10;
  const id = (actor: number) => players[actor].accountId;

  async function match(a: number, b: number, options: {
    winner?: 0 | 1; delay?: number; stakeUnits?: string; replay?: boolean; bankEndAt?: number;
  } = {}) {
    const time = nextAt;
    nextAt += 20_000;
    const creator = players[a], opponent = players[b], ids = [creator.accountId, opponent.accountId];
    await store.syncRoom(creator.roomId, players, time);
    const result = await store.command(creator, { id: randomUUID(), action: 'create', gameId: 'chess',
      stakeUnits: options.stakeUnits ?? '1000000', targetId: opponent.accountId }, time + 1);
    const matchId = result.active!.id;
    await store.command(opponent, { id: randomUUID(), action: 'accept', challengeId: matchId }, time + 2);
    await store.command(creator, { id: randomUUID(), action: 'ready', challengeId: matchId }, time + 3);
    const ready = await store.command(opponent, { id: randomUUID(), action: 'ready', challengeId: matchId }, time + 4);
    const winner = options.winner ?? 0;
    let recording: CapturedChessReplay | undefined;
    if (options.replay) {
      let at = 100;
      const capture = new ChessTurnReplayCapture(session => session, record => { recording = record; }, () => at);
      const chess = new ChessGame(undefined, () => at);
      chess.setReplayObserver(event => capture.observeEngine(event));
      capture.observeMatches([ready.active!]);
      for (const account of ids) assert.equal(chess.join(account), true);
      for (const [seat, from, to] of [
        [0, 'e2', 'e4'], [1, 'e7', 'e5'], [0, 'g1', 'f3'], [1, 'b8', 'c6'],
        [0, 'f1', 'c4'], [1, 'g8', 'f6'], [0, 'd2', 'd3'], [1, 'd7', 'd6'],
      ] as const) {
        at += options.delay ?? 100;
        assert.equal(chess.move(ids[seat], from, to, undefined), true);
      }
      at += 2000;
      assert.equal(chess.resign(ids[1 - winner]), true);
      capture.observeAdjudication(matchId, ids[winner], 'win', time + 15_000);
      assert.ok(recording);
    }
    await store.adjudicate(creator.roomId, matchId, ids[winner], 'win', options.bankEndAt ?? time + 15_000);
    if (recording) assert.equal(await persistCapturedChessReplay(audit, scope, game.schema, recording), 'recorded');
    return matchId;
  }

  async function timedMatch(gameId: TimedMode, a: number, b: number, options: {
    fast: boolean; clock?: 'source-order';
  }) {
    let now = nextAt;
    nextAt += 20_000;
    const [creator, opponent] = [players[a], players[b]], actors = [creator, opponent];
    const cardRecordings: CapturedCardReplay[] = [], tsuRecordings: CapturedTsuReplay[] = [];
    const cards = new CardsTurnReplayCapture(recording => cardRecordings.push(recording));
    const tsu = new TsuTurnReplayCapture(recording => tsuRecordings.push(recording));
    const simultaneous = gameId === 'tsu-e-fa';
    const sync = async (at: number) => {
      now = at;
      const snapshots = await store.syncRoom(creator.roomId, players, now);
      if (simultaneous) for (const row of snapshots) tsu.observeSnapshot(row.snapshot);
      return snapshots.find(row => row.accountId === creator.accountId)!.snapshot;
    };
    const command = async (seat: number, request: PvpRequest, delay = 1) => {
      now += delay;
      const result = await store.command(actors[seat], request, now);
      if (simultaneous) tsu.observeCommand(actors[seat].accountId, request, result);
      else cards.observeCommand(actors[seat].accountId, request, result);
      return result;
    };
    await sync(now);
    const terms = { id: randomUUID(), stakeUnits: '1000000', targetId: opponent.accountId };
    const created = await command(0, simultaneous
      ? { ...terms, action: 'invite', gameId }
      : { ...terms, action: 'create', gameId });
    const matchId = created.active!.id;
    await command(1, { id: randomUUID(), action: 'accept', challengeId: matchId });
    const ready = (seat: number) => command(seat, simultaneous
      ? { id: randomUUID(), action: 'duel-ready', challengeId: matchId, termsRevision: 0 }
      : { id: randomUUID(), action: 'ready', challengeId: matchId });
    await ready(0);
    const started = await ready(1);
    assert.equal(started.active?.status, 'playing');
    if (simultaneous) {
      const choose = (seat: number, round: number) => command(seat, { id: randomUUID(), action: 'move', challengeId: matchId,
        revision: 0, move: { kind: 'choose', round, choice: 'rock' } }, 100);
      await choose(1, 1);
      const bothLocked = await choose(0, 1);
      const revealed = await sync(bothLocked.tsuEFa!.duel!.endsAt);
      await sync(revealed.tsuEFa!.duel!.endsAt);
      await choose(1, 2);
      await choose(0, 2);
    } else {
      let view = started.cards!, previousSeat: number | undefined;
      const changes = [0, 0];
      for (let count = 0; count < 16 && changes.some(total => total < 2); count++) {
        const seat = view.actor;
        const current = (await store.snapshot(actors[seat], now)).cards!;
        const move = current.moves.find(move => move.kind === 'done') ?? current.moves[0];
        assert.ok(move);
        const updated = await command(seat, { id: randomUUID(), action: 'move', challengeId: matchId,
          revision: current.revision, move }, options.fast ? 100 : 1200);
        assert.equal(updated.active?.status, 'playing');
        if (previousSeat !== undefined && previousSeat !== seat) changes[seat]++;
        previousSeat = seat;
        view = updated.cards!;
        // Keep the room active when a deliberately slow fixture crosses the heartbeat interval.
        if (now - started.now > 10_000) await sync(now);
      }
      assert.ok(changes.every(total => total >= 2));
    }
    const terminalDelay = Math.max(1, started.now + (options.fast ? 10_000 : 12_000) - now);
    const terminal = await command(0, { id: randomUUID(), action: 'resign', challengeId: matchId }, terminalDelay);
    assert.equal(terminal.active?.reason, 'resign');
    if (simultaneous) {
      assert.equal(tsuRecordings.length, 1);
      assert.equal(await persistCapturedTsuReplay(audit, scope, game.schema, tsuRecordings[0]), 'recorded');
    } else {
      assert.equal(cardRecordings.length, 1);
      const recording = cardRecordings[0];
      if (options.clock === 'source-order' && recording.initial) recording.initial.startedAtMs = null;
      assert.equal(await persistCapturedCardReplay(audit, scope, game.schema, recording), 'recorded');
    }
    return matchId;
  }

  const comparison = [2, 3, 4, 5];
  async function baseline(replay = false) {
    const matches: string[] = [];
    for (const [a, b] of [[2, 3], [2, 4], [2, 5], [3, 4], [3, 5], [4, 5]]) {
      matches.push(await match(a, b, { replay, delay: 1200 }));
    }
    return matches;
  }
  async function timedBaseline(gameId: TimedMode) {
    const matches: string[] = [];
    for (const [a, b] of [[2, 3], [2, 4], [2, 5], [3, 4], [3, 5], [4, 5]]) {
      matches.push(await timedMatch(gameId, a, b, { fast: false }));
    }
    return matches;
  }
  const window = (subject: number[], asOfMs = toMs) => ({
    scope, gameSchema: game.schema, subjectAccountIds: subject.map(id), comparisonAccountIds: comparison.map(id),
    fromMs, toMs, asOfMs,
  });
  const select = (subject: number[], asOfMs = toMs) => selectPvpRisk(audit, window(subject, asOfMs));
  return { game, audit, scope, id, match, baseline, timedMatch, timedBaseline, select, window, toMs };
}

function candidate(candidates: AuditRiskCandidate[], rule: keyof typeof pvpRiskRules, stake = '100') {
  const selected = candidates.find(item => item.rule.id === pvpRiskRules[rule].id &&
    item.segment.includes(':virtual-usdt-pvp-v1:' + stake + ':'));
  assert.ok(selected, 'expected scoped PvP candidate ' + rule);
  return selected;
}

test('distinguishes concentrated one-way wallet series from similar fair series, and separates confirmed accounting faults', async t => {
  const f = await fixture(t);
  const concentrated: string[] = [];
  for (let index = 0; index < 6; index++) concentrated.push(await f.match(0, 1));
  for (const actor of [7, 8, 9]) {
    await f.match(6, actor, { winner: 0 });
    await f.match(6, actor, { winner: 1 });
  }
  await f.baseline();
  const mixed = await f.match(0, 2);
  await f.match(2, 3, { stakeUnits: '2000000' });

  const suspicious = await f.select([0]);
  for (const rule of ['opponents', 'direction'] as const) {
    const report = candidate(suspicious, rule);
    const signal = evaluateAuditRiskRule(report.rule, report.input);
    assert.equal(signal.status, 'observed');
    assert.deepEqual(signal.subject, { observations: 7, accounts: 1, numerator: '6', denominator: '7' });
    assert.deepEqual(signal.comparison, { observations: 12, accounts: 4, numerator: '4', denominator: '12' });
    assert.ok(signal.input.observations.some(row => row.entity?.source.rowId === mixed && row.primary.accountId === f.id(0)));
    assert.ok(!signal.input.observations.some(row => row.entity?.source.rowId === mixed && row.primary.accountId === f.id(2)));
    assert.ok(signal.input.observations.every(row => row.asset?.code === 'VIRTUAL_USD' && row.supporting.length === 2));
    const persisted = await new AuditRiskSignals(f.audit, new AuditPostingReader(f.audit, f.game)).record(signal);
    assert.equal(persisted?.signal.status, 'observed');
  }

  const fair = await f.select([6]);
  for (const rule of ['opponents', 'direction'] as const) {
    const report = candidate(fair, rule);
    assert.equal(evaluateAuditRiskRule(report.rule, report.input).status, 'clear');
  }
  const group = candidate(await f.select([0, 6]), 'opponents');
  const grouped = evaluateAuditRiskRule(group.rule, group.input);
  assert.equal(grouped.subject.accounts, 2);
  assert.equal(grouped.subject.observations, 13);

  await f.game.prepare('UPDATE virtual_pvp_banks SET fee_units=999 WHERE match_id=?').run(concentrated[0]);
  const broken = candidate(await f.select([0]), 'opponents');
  assert.equal(evaluateAuditRiskRule(broken.rule, broken.input).status, 'insufficient-data');
  assert.equal(broken.input.completeness.subject, false);
  assert.ok(broken.financialFindings?.some(finding => finding.code === 'commission-mismatch' &&
    finding.source.rowId === concentrated[0] && finding.postings.length === 3));
  assert.ok(!broken.input.observations.some(row => row.entity?.source.rowId === concentrated[0]));
});

test('uses verified replay actions for own quick resignation and accepted response intervals', async t => {
  const f = await fixture(t, 6);
  for (let index = 0; index < 6; index++) await f.match(0, 1, { replay: true, delay: 100, winner: 1 });
  const baseline = await f.baseline(true);
  const candidates = await f.select([0]);
  for (const rule of ['resignation', 'response'] as const) {
    const report = candidate(candidates, rule);
    const signal = evaluateAuditRiskRule(report.rule, report.input);
    assert.equal(signal.status, 'observed');
    assert.equal(report.rule.version, '1');
    assert.deepEqual(signal.subject, { observations: 6, accounts: 1, numerator: '6', denominator: '6' });
    assert.deepEqual(signal.comparison, { observations: 12, accounts: 4, numerator: '0', denominator: '12' });
    assert.ok(report.replayLinks && report.replayLinks.length >= 12);
    assert.ok(report.replayLinks.every(link => link.replayId === link.source.rowId && link.sequence > 0));
  }

  // A manifest alone can prove neither move intervals nor a resignation.
  await f.audit.prepare('DELETE FROM audit_replay_fragments WHERE dataset_id=? AND replay_id=?').run(f.scope.datasetId, baseline[0]);
  const incomplete = await f.select([0]);
  for (const rule of ['resignation', 'response'] as const) {
    const report = candidate(incomplete, rule);
    assert.equal(evaluateAuditRiskRule(report.rule, report.input).status, 'insufficient-data');
    assert.equal(report.input.completeness.comparison, false);
    assert.ok(!report.replayLinks?.some(link => link.replayId === baseline[0]));
  }
  assert.equal(evaluateAuditRiskRule(candidate(incomplete, 'direction').rule, candidate(incomplete, 'direction').input).status, 'observed');
});

for (const gameId of ['durak', 'transfer-durak', 'crazy-eights'] as const) {
  test(gameId + ' measures accepted card actions and voluntary surrenders against a slow comparison group', async t => {
    const f = await fixture(t, 8);
    const matches: string[] = [];
    for (let index = 0; index < 6; index++) matches.push(await f.timedMatch(gameId, 0, 1, { fast: true }));
    await f.timedBaseline(gameId);
    const candidates = await f.select([0]);
    for (const rule of ['resignation', 'response'] as const) {
      const report = candidate(candidates, rule);
      const signal = evaluateAuditRiskRule(report.rule, report.input);
      assert.equal(report.rule.version, '2');
      assert.equal(signal.status, 'observed');
      assert.deepEqual(signal.subject, { observations: 6, accounts: 1, numerator: '6', denominator: '6' });
      assert.deepEqual(signal.comparison, { observations: 12, accounts: 4, numerator: '0', denominator: '12' });
      assert.ok(matches.every(id => report.replayLinks?.some(link => link.replayId === id && link.sequence > 0)));
      const saved = await new AuditRiskSignals(f.audit, new AuditPostingReader(f.audit, f.game)).record(signal);
      assert.equal(saved?.signal.status, 'observed');
    }

    if (gameId === 'crazy-eights') {
      for (let index = 0; index < 6; index++) await f.timedMatch(gameId, 6, 7, { fast: false });
      const fair = await f.select([6]);
      for (const rule of ['resignation', 'response'] as const) {
        const report = candidate(fair, rule);
        assert.equal(evaluateAuditRiskRule(report.rule, report.input).status, 'clear');
      }
    }
    const orderOnly = await f.timedMatch(gameId, 0, 1, { fast: true, clock: 'source-order' });
    const incomplete = await f.select([0]);
    for (const rule of ['resignation', 'response'] as const) {
      const report = candidate(incomplete, rule);
      assert.equal(evaluateAuditRiskRule(report.rule, report.input).status, 'insufficient-data');
      assert.equal(report.input.completeness.subject, false);
      assert.ok(!report.replayLinks?.some(link => link.replayId === orderOnly));
    }
  });
}

test('Tsu v4 identifies quick voluntary surrenders without treating simultaneous choices as responses', async t => {
  const f = await fixture(t, 8);
  const matches: string[] = [];
  for (let index = 0; index < 6; index++) matches.push(await f.timedMatch('tsu-e-fa', 0, 1, { fast: true }));
  await f.timedBaseline('tsu-e-fa');
  const candidates = await f.select([0]);
  const resignation = candidate(candidates, 'resignation');
  assert.equal(resignation.rule.version, '2');
  const signal = evaluateAuditRiskRule(resignation.rule, resignation.input);
  assert.equal(signal.status, 'observed');
  assert.deepEqual(signal.subject, { observations: 6, accounts: 1, numerator: '6', denominator: '6' });
  assert.deepEqual(signal.comparison, { observations: 12, accounts: 4, numerator: '0', denominator: '12' });
  assert.ok(matches.every(id => resignation.replayLinks?.some(link => link.replayId === id && link.sequence > 0)));
  const saved = await new AuditRiskSignals(f.audit, new AuditPostingReader(f.audit, f.game)).record(signal);
  assert.equal(saved?.signal.status, 'observed');
  const response = candidate(candidates, 'response');
  assert.equal(response.rule.version, '2');
  assert.equal(response.input.observations.length, 0);
  assert.equal(evaluateAuditRiskRule(response.rule, response.input).status, 'insufficient-data');
  assert.deepEqual(response.input.completeness, { subject: false, comparison: false });
  assert.equal(response.replayLinks, undefined);

  for (let index = 0; index < 6; index++) await f.timedMatch('tsu-e-fa', 6, 7, { fast: false });
  const fair = candidate(await f.select([6]), 'resignation');
  assert.equal(evaluateAuditRiskRule(fair.rule, fair.input).status, 'clear');
});

test('reviewers retain exact subject replay jumps across reads and attachment upgrades without source grants', async t => {
  const f = await fixture(t, 6);
  const matches: string[] = [];
  for (let index = 0; index < 6; index++) matches.push(await f.timedMatch('durak', 0, 1, { fast: true }));
  await f.timedBaseline('durak');
  const initial = candidate(await f.select([0]), 'resignation');
  const signal = evaluateAuditRiskRule(initial.rule, initial.input);
  const subjectLink = initial.replayLinks!.find(link => matches.includes(link.replayId))!;
  const peerLink = initial.replayLinks!.find(link => !matches.includes(link.replayId))!;
  const storage = new AuditRiskSignals(f.audit, new AuditPostingReader(f.audit, f.game));
  assert.equal((await storage.record(signal))?.revision, 1);

  const login = 'risk_' + randomBytes(8).toString('hex'), password = randomBytes(24).toString('hex');
  const role = identifier(login), schema = identifier(f.audit.schema);
  await f.audit.exec(`CREATE ROLE ${role} LOGIN PASSWORD '${password}';
    GRANT USAGE ON SCHEMA ${schema} TO ${role};
    GRANT SELECT ON ${schema}.audit_risk_signals,${schema}.audit_datasets TO ${role};
    GRANT UPDATE (review) ON ${schema}.audit_risk_signals TO ${role}`);
  const operator = new PostgresDatabase(f.audit.schema, { existingSchema: true, config: { ...databaseConfig(), user: login, password } });
  t.after(async () => {
    await operator.close();
    const admin = new PostgresDatabase(f.audit.schema, { existingSchema: true });
    try { await admin.exec(`DROP OWNED BY ${role}; DROP ROLE ${role}`); }
    finally { await admin.close(); }
  });
  const review = (expectedRevision: number) => reviewAuditRiskReportSignal(operator, f.scope, signal.key,
    { expectedRevision, decision: 'explained' });
  const read = () => readAuditRiskReportSignal(operator, f.scope, signal.key);
  assert.equal((await review(1))?.review?.reviewerId, login);

  // Simulate the prior installation with a reviewed row and apply only the forward migration.
  await f.audit.exec('ALTER TABLE audit_risk_signals DROP COLUMN replay_links');
  await f.audit.prepare('DELETE FROM _royal_migrations WHERE id=?').run('paid-activity-audit-risk-replay-links-v1');
  await migrateAuditRiskSignals(f.audit);
  assert.equal((await read())?.reviewStatus, 'reviewed');
  assert.deepEqual((await read())?.replayLinks, []);

  await assert.rejects(storage.record(signal, [peerLink]), /outside subject evidence/);
  await assert.rejects(storage.record(signal, [{ ...subjectLink, replayId: peerLink.replayId }]), /does not match/);
  await assert.rejects(storage.record(signal, [{ ...subjectLink, sequence: 9999 }]), /does not match/);
  await assert.rejects(storage.record(signal, [{ ...subjectLink, replayId: randomUUID() }]), /unavailable/);
  assert.deepEqual((await read())?.replayLinks, []);
  await assert.rejects(operator.prepare('SELECT manifest FROM audit_replay_packages').get(), /permission denied/);

  const report = await runAuditRiskReport(f.audit, f.game, f.window([0]), 'pvp');
  const saved = report.signals.find(row => row.key === signal.key)!;
  assert.equal(saved.revision, 1);
  assert.equal(saved.reviewStatus, 'reviewed');
  assert.deepEqual(saved.replayLinks.map(link => link.replayId).sort(), matches.sort());
  assert.deepEqual((await read())?.replayLinks, saved.replayLinks);
  assert.deepEqual((await review(1))?.replayLinks, saved.replayLinks);
  assert.equal(await readAuditRiskReportSignal(operator, { ...f.scope, environment: 'live' }, signal.key), null);

  const refreshed = evaluateAuditRiskRule(initial.rule, { ...initial.input, asOfMs: f.toMs + 1,
    completeness: { ...initial.input.completeness, subject: false } });
  await f.audit.prepare('DELETE FROM audit_replay_fragments WHERE dataset_id=? AND replay_id=?')
    .run(f.scope.datasetId, subjectLink.replayId);
  await assert.rejects(storage.record(refreshed, saved.replayLinks), /replay unavailable/);
  assert.equal((await read())?.revision, 1);
  assert.equal((await storage.record(refreshed))?.revision, 2);
  assert.deepEqual((await read())?.replayLinks, []);
  assert.equal((await read())?.reviewStatus, 'needs-review');
  await assert.rejects(review(1), /requires current finding/);
  assert.equal((await storage.record(signal, [subjectLink]))?.revision, 2);
  assert.deepEqual((await read())?.replayLinks, []);
});

test('omits a future terminal from an as-of sample and treats the affected side as partial', async t => {
  const f = await fixture(t, 6);
  const late = await f.match(0, 1, { bankEndAt: f.toMs + 1 });
  for (let index = 0; index < 6; index++) await f.match(0, 1);
  await f.baseline();
  const report = candidate(await f.select([0]), 'direction');
  assert.equal(report.input.completeness.subject, false);
  assert.ok(!report.input.observations.some(row => row.entity?.source.rowId === late));
  assert.equal(evaluateAuditRiskRule(report.rule, report.input).status, 'insufficient-data');
});

test('bounds fragmented stake segments and marks unavailable wallet sources as gaps', async t => {
  const f = await fixture(t, 6);
  for (let index = 0; index < 24; index++) await f.match(0, 1, { stakeUnits: String(1000000 + index * 100000) });
  const bounded = await f.select([0]);
  assert.equal(bounded.length, 96);
  assert.equal(bounded.filter(item => item.segment === 'pvp-segment-limit').length, 4);
  assert.ok(bounded.filter(item => item.segment === 'pvp-segment-limit').every(item => !item.input.completeness.subject));
  await f.game.exec('ALTER TABLE combat_matches RENAME TO unavailable_combat_matches');
  const unavailable = await f.select([0]);
  assert.equal(unavailable.length, 4);
  assert.ok(unavailable.every(item => item.segment === 'pvp-source-unavailable' &&
    evaluateAuditRiskRule(item.rule, item.input).status === 'insufficient-data'));
});
