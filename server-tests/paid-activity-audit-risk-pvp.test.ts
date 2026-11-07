import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditPostingReader } from '../server/audit/postings';
import { persistCapturedChessReplay } from '../server/audit/replay-chess-storage';
import { ChessTurnReplayCapture, type CapturedChessReplay } from '../server/audit/replay-pvp-turn';
import { selectPvpRisk, pvpRiskRules } from '../server/audit/risk-pvp';
import { evaluateAuditRiskRule } from '../server/audit/risk-rules';
import { RISK_WINDOW_MS, type AuditRiskCandidate } from '../server/audit/risk-selection';
import { AuditRiskSignals } from '../server/audit/risk-store';
import { ChessGame } from '../server/chessGame';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';

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

  const comparison = [2, 3, 4, 5];
  async function baseline(replay = false) {
    const matches: string[] = [];
    for (const [a, b] of [[2, 3], [2, 4], [2, 5], [3, 4], [3, 5], [4, 5]]) {
      matches.push(await match(a, b, { replay, delay: 1200 }));
    }
    return matches;
  }
  const select = (subject: number[], asOfMs = toMs) => selectPvpRisk(audit, {
    scope, gameSchema: game.schema, subjectAccountIds: subject.map(id), comparisonAccountIds: comparison.map(id),
    fromMs, toMs, asOfMs,
  });
  return { game, audit, scope, id, match, baseline, select, toMs };
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
