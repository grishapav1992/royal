import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import express from 'express';
import { startAuditAttemptRuntime } from '../server/audit/attempts';
import { checkCapturedCasinoRound } from '../server/audit/check-casino';
import { reconcileStoredPvpMatch } from '../server/audit/check-pvp';
import { reconcileStoredTotePool } from '../server/audit/check-tote';
import { initializeAuditExportDirectory, registerAuditExportFile } from '../server/audit/cleanup-files';
import { applyAuditCleanup, installAuditCleanup, previewAuditCleanup } from '../server/audit/cleanup';
import { AuditDatasets } from '../server/audit/datasets';
import { auditHttpAttempts } from '../server/audit/http-attempts';
import { auditCommandRoutes } from '../server/audit/intents';
import { persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { persistCapturedToteReplay } from '../server/audit/replay-tote';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { installAuditPlayerReport } from '../server/audit/report-player-source';
import { exportAuditPlayer } from '../server/audit/report-player';
import { installAuditSummaryReport } from '../server/audit/report-summary-source';
import { readAuditSummary } from '../server/audit/report-summary';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { FlagToteStore } from '../server/flagTote';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
// @ts-ignore The independent qualification fixture is JavaScript without declarations.
import { cascadeRandom } from '../scripts/game-math/rtp-temple-cascade-model.mjs';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../src/shared/caribbeanTreasures';
import type { ExpansionAction } from '../src/shared/casinoExpansion';
import { TOTE_TIMING } from '../src/shared/flagTote';

async function observed<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = performance.now() + 3000;
  for (;;) {
    const result = await read();
    if (result !== undefined) return result;
    if (performance.now() >= deadline) throw new Error('Rehearsal observer did not reach the expected state');
    await pause(5);
  }
}

test('isolated rehearsal settles accepted casino, PvP and shared pool money after observer failure and test-to-live cutover',
  { timeout: 25_000 }, async t => {
    // The project database runner supplies these values and creates a disposable local cluster.
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.PGHOST, '127.0.0.1');
    assert.equal(process.env.PGDATABASE, 'royal_test');
    assert.equal(process.env.DATABASE_URL, '');
    assert.equal(process.env.DATABASE_URL_FILE, '');
    const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
    const readOnlyAudit = new PostgresDatabase(audit.schema, { readOnly: true, existingSchema: true });
    let runtime: ReturnType<typeof startAuditAttemptRuntime>;
    t.after(async () => {
      try { await runtime?.close(); }
      finally { await Promise.all([game.close(), audit.close(), readOnlyAudit.close()]); }
    });
    const player = randomUUID(), other = randomUUID();
    await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(player, other);
    const wallet = new DemoWalletStore(game, cascadeRandom(129733));
    for (const account of [player, other]) {
      await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 1000 });
    }
    const bank = new VirtualPvpLedger(game, wallet);
    const pvp = new PvpStore(bank), combat = new NileCombatEscrow(bank);
    await Promise.all([pvp.ready, combat.ready]);
    const a = { accountId: player, name: 'Rehearsal A', roomId: 'rehearsal' };
    const b = { accountId: other, name: 'Rehearsal B', roomId: a.roomId };
    const beginMatch = async (now: number) => {
      await pvp.syncRoom(a.roomId, [a, b].map(actor => ({ ...actor, connected: true, available: true })), now);
      const command = { id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '10000000', targetId: b.accountId };
      const match = (await pvp.command(a, command, now)).active!.id;
      const accept = { id: randomUUID(), action: 'accept', challengeId: match };
      await pvp.command(b, accept, now + 1);
      await pvp.command(b, accept, now + 1);
      for (const actor of [a, b]) await pvp.command(actor, { id: randomUUID(), action: 'ready', challengeId: match }, now + 2);
      return match;
    };
    const sources = { game: game.schema }, namespace = game.schema + '.demo_ledger';
    const datasets = new AuditDatasets(audit, sources);
    const testDataset = await datasets.startTest();
    await installAuditCleanup(audit);
    const filesRoot = await realpath(await mkdtemp(join(tmpdir(), 'royal-audit-rehearsal-')));
    t.after(() => rm(filesRoot, { recursive: true, force: true }));
    const testExports = await initializeAuditExportDirectory(filesRoot, testDataset.datasetId);
    const cleanup = { datasetId: testDataset.datasetId, sources, filesRoot };
    const tag = randomUUID().replaceAll('-', '').slice(0, 12);
    const group = 'rehearsal_read_' + tag, operator = 'rehearsal_operator_' + tag, password = randomUUID();
    await audit.exec(`CREATE ROLE ${identifier(group)} NOLOGIN;
      CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
      GRANT ${identifier(group)} TO ${identifier(operator)};
      ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB'`);
    await installAuditReportAccess(audit, group);
    await installAuditPlayerReport(audit, group, sources);
    await installAuditSummaryReport(audit, group, sources);
    await installAuditDetailReport(audit, group, sources);
    const grant = (datasetId: string) =>
      audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(operator, datasetId, namespace);
    await grant(testDataset.datasetId);
    const reader = databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
      PGUSER: operator, PGPASSWORD: password, PGPASSWORD_FILE: '' });
    const observerEnv = { ...process.env, ROYAL_AUDIT_SCHEMA: audit.schema,
      ROYAL_AUDIT_TEST_DATASET_ID: undefined, ROYAL_AUDIT_LIVE_DATASET_ID: undefined,
      ROYAL_AUDIT_TOTE_ADMISSION: '1', ROYAL_AUDIT_CHESS_REPLAY: undefined, ROYAL_AUDIT_COMBAT_REPLAY: undefined,
      ROYAL_AUDIT_CARD_REPLAY: undefined, ROYAL_AUDIT_SPORT_REPLAY: undefined, ROYAL_AUDIT_TSU_REPLAY: undefined };
    runtime = startAuditAttemptRuntime({ ...observerEnv, ROYAL_AUDIT_TEST_DATASET_ID: testDataset.datasetId }, game.schema);
    assert(runtime?.recordToteAdmission);
    const stopObserver = async () => {
      const active = runtime;
      runtime = undefined;
      await active?.close();
    };
    const app = express();
    const observer = auditHttpAttempts(record => runtime?.record(record), { gameSchema: game.schema });
    app.use(express.json({ limit: '4kb' }));
    app.use((req, res, next) => {
      res.locals.accountId = player;
      if (runtime) observer(req, res, next);
      else next();
    });
    app.post(auditCommandRoutes.expansion, async (req, res) => { res.json(await wallet.expansion.operate(player, req.body)); });
    app.post(auditCommandRoutes.core, async (req, res) => { res.json(await wallet.operate(player, req.body)); });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>(resolveClose => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    }));
    const address = server.address();
    assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
    const send = async <T>(route: string, body: unknown): Promise<T> => {
      const result = await fetch('http://127.0.0.1:' + address.port + route, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(result.status, 200);
      return result.json() as Promise<T>;
    };
    const expand = (command: ExpansionAction) =>
      send<Awaited<ReturnType<typeof wallet.expansion.operate>>>(auditCommandRoutes.expansion, command);
    const capture = async (operationId: string, entry = 'bet', account = player) => {
      const posting = await game.prepare('SELECT id::text FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type=?')
        .get(account, operationId, entry);
      assert(posting);
      return { namespace, rowId: posting.id as string };
    };

    let poolNow = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period + 1;
    const pool = new FlagToteStore(game, id => wallet.snapshotInTransaction(id), wallet.ready, () => poolNow, () => 0);
    pool.setAdmissionObserver(runtime.recordToteAdmission);
    const { round } = await pool.snapshot(player);
    const tickets = [
      { account: player, id: randomUUID(), roundId: round.id, rulesVersion: 1, country: 'FR', stakeUnits: '100' },
      { account: player, id: randomUUID(), roundId: round.id, rulesVersion: 1, country: 'BR', stakeUnits: '200' },
      { account: other, id: randomUUID(), roundId: round.id, rulesVersion: 1, country: 'DE', stakeUnits: '100' },
    ] as const;
    // These direct store calls represent historical tickets. The public new-ticket HTTP guard is tested independently.
    for (const { account, ...ticket } of tickets) await pool.bet(account, ticket);
    const matchClock = Date.now();
    const match = await beginMatch(matchClock);
    const roundId = randomUUID();
    const settings = { caribbean: { mode: 'buy-raid', lines: 5, stakeBasis: 'total' } } as const;
    const start = { id: roundId, gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings } as const;
    await audit.exec(`CREATE FUNCTION rehearsal_reject_attempt() RETURNS trigger LANGUAGE plpgsql AS $fixture$
      BEGIN RAISE EXCEPTION 'Rehearsal injected write failure' USING ERRCODE='42501'; END $fixture$;
      CREATE TRIGGER rehearsal_reject_attempt BEFORE INSERT ON audit_evidence FOR EACH ROW
      WHEN (NEW.kind='attempt' AND NEW.payload->>'operationId'='${roundId}') EXECUTE FUNCTION rehearsal_reject_attempt()`);
    const opened = await expand(start);
    assert.equal(opened.session.state, 'active');
    assert.equal(opened.session.spentUnits, caribbeanInitialCost(settings.caribbean, '100'));
    const casinoAnchor = await capture(roundId);
    const matchAnchor = await capture('pvp:' + match + ':hold');
    const ticketAnchor = await capture('flag-tote:' + tickets[0].id);
    const failure = await observed(() => audit.prepare('SELECT missing_count FROM audit_attempt_capture_gaps WHERE dataset_id=?')
      .get(testDataset.datasetId));
    assert.equal(failure.missing_count, 1);
    const capturedStart = await audit.prepare('SELECT source_row_id::text FROM audit_posting_refs WHERE dataset_id=? AND operation_id=?')
      .get(testDataset.datasetId, roundId);
    assert.equal(capturedStart?.source_row_id, casinoAnchor.rowId);
    assert.equal(await audit.prepare("SELECT 1 FROM audit_evidence WHERE dataset_id=? AND kind='attempt'").get(testDataset.datasetId), undefined);
    await audit.exec('DROP TRIGGER rehearsal_reject_attempt ON audit_evidence; DROP FUNCTION rehearsal_reject_attempt()');
    const replayed = await expand(start);
    assert.equal(replayed.replayed, true);
    const retry = await observed(() => audit.prepare("SELECT payload FROM audit_evidence WHERE dataset_id=? AND kind='attempt'")
      .get(testDataset.datasetId));
    assert.equal(retry.payload.operationId, roundId);
    assert.equal(retry.payload.decision, 'replayed');

    const early = await previewAuditCleanup(readOnlyAudit, cleanup);
    for (const relation of ['demo_casino_sessions', 'virtual_pvp_holds', 'flag_tote_reservations']) {
      assert(early.blockers.includes('open-financial-source:' + game.schema + '.' + relation));
    }
    assert(early.blockers.includes('test-dataset-not-sealed'));
    pool.setAdmissionObserver(undefined);
    await stopObserver();

    let session = opened.session;
    const moves: Extract<ExpansionAction, { action: 'move' }>[] = [];
    while (session.state === 'active') {
      assert(moves.length < 40);
      const move = { id: randomUUID(), gameId: CARIBBEAN_GAME, action: 'move', sessionId: roundId,
        move: 'caribbean-spin', revision: session.view.caribbean!.revision } as const;
      moves.push(move);
      session = (await expand(move)).session;
    }
    assert.equal(session.state, 'settled');
    assert(moves.length > 0);
    assert.equal((await expand(moves.at(-1)!)).replayed, true);
    await pvp.adjudicate(a.roomId, match, player, 'win', matchClock + 3);
    await pvp.adjudicate(a.roomId, match, player, 'win', matchClock + 4);
    poolNow = round.finishesAt;
    await pool.advance();
    await pool.advance();
    const { account: ticketOwner, ...repeatTicket } = tickets[0];
    assert.equal((await pool.bet(ticketOwner, repeatTicket)).replayed, true);
    assert.equal((await audit.prepare("SELECT count(*)::int AS n FROM audit_evidence WHERE dataset_id=? AND kind='attempt'")
      .get(testDataset.datasetId))?.n, 1);
    assert.equal((await audit.prepare("SELECT count(*)::int AS n FROM audit_evidence WHERE dataset_id=? AND kind='event'")
      .get(testDataset.datasetId))?.n, 3);

    const casinoCheck = await checkCapturedCasinoRound(audit, { datasetId: testDataset.datasetId, gameSchema: game.schema, posting: casinoAnchor });
    assert.equal(casinoCheck.status, 'found');
    assert.equal(casinoCheck.result.stake.status, 'match');
    assert.equal(casinoCheck.result.stake.expectedUnits, caribbeanInitialCost(settings.caribbean, '100'));
    assert.equal(casinoCheck.result.payout.status, 'match');
    assert.equal(casinoCheck.result.payout.observedUnits, session.returnedUnits);
    assert(casinoCheck.result.steps.filter(step => step.kind === 'free').length === moves.length &&
      casinoCheck.result.steps.filter(step => step.kind === 'free').every(step => step.status === 'match' && step.observedUnits === '0'));
    const pvpCheck = await reconcileStoredPvpMatch(audit, game, testDataset.datasetId, match);
    assert.equal(pvpCheck.status, 'match');
    assert.deepEqual(pvpCheck.totals, { stakeUnits: '2000', payoutUnits: '1900', refundUnits: '0', feeUnits: '100', remainderUnits: '0' });
    const poolCheck = await reconcileStoredTotePool(audit, game, testDataset.datasetId, round.id);
    assert.equal(poolCheck?.status, 'match');
    assert.equal(poolCheck.bankUnits, '400');
    const finalPool = await game.prepare("SELECT account_id,amount_units::text FROM demo_ledger WHERE operation_id=? AND entry_type='win'")
      .all('flag-tote:' + round.id + ':final');
    assert.equal(finalPool.length, 2);
    assert.equal(new Set(finalPool.map(item => item.account_id)).size, finalPool.length);
    assert.equal(finalPool.reduce((total, item) => total + BigInt(item.amount_units), 0n), 380n);
    assert.equal((await persistCapturedCasinoReplay(audit, {
      datasetId: testDataset.datasetId, gameSchema: game.schema, posting: casinoAnchor, replayId: randomUUID(),
    })).status, 'stored');
    assert.equal((await persistCapturedToteReplay(audit, {
      datasetId: testDataset.datasetId, gameSchema: game.schema, poolId: round.id, replayId: randomUUID(),
    })).status, 'stored');

    const period = (fromMs: number) => ({ fromMs, toMs: Date.now() + 60_000 });
    const testExport = join(testExports, 'postings.csv');
    const reportInput = (datasetId: string, fromMs: number, destination: string) =>
      ({ schema: audit.schema, datasetId, filters: { accountId: player, ...period(fromMs) }, destination });
    assert.equal((await exportAuditPlayer(reader, reportInput(testDataset.datasetId, testDataset.startedAtMs, testExport))).rowCount, 7);
    const csvBefore = await readFile(testExport, 'utf8');
    for (const id of [testDataset.datasetId, roundId, match, tickets[0].id]) assert(csvBefore.includes(id));
    const testSummary = await readAuditSummary(reader, { schema: audit.schema, datasetId: testDataset.datasetId,
      filters: period(testDataset.startedAtMs) });
    assert.equal(testSummary.environment, 'test');
    assert.equal(testSummary.scanned, 10);
    const poolPayout = testSummary.rows.find(row => row.category === 'totalizator' && row.movement_type === 'payout');
    assert.deepEqual([poolPayout?.posting_count, poolPayout?.amount_units], ['2', '380']);
    assert.equal(testSummary.rows.find(row => row.category === 'totalizator' && row.movement_type === 'fee')?.fee_units, '20');
    await registerAuditExportFile(filesRoot, testDataset.datasetId, 'postings.csv');
    await datasets.sealTest(testDataset.datasetId);
    const manifest = await previewAuditCleanup(readOnlyAudit, cleanup);
    assert.deepEqual(manifest.blockers, []);
    assert.equal(manifest.files.files.length, 1);
    for (const [table, rows] of [['audit_posting_refs', 10], ['audit_evidence', 4], ['audit_attempt_capture_gaps', 1],
      ['audit_replay_packages', 2], ['audit_export_jobs', 2], ['audit_report_acl', 1]] as const) {
      assert.equal(manifest.rows.find(item => item.table === table)?.rows, rows);
    }
    const sourcesSnapshot = () => Promise.all(['demo_ledger', 'demo_wallets', 'demo_casino_requests', 'demo_casino_sessions',
      'pvp_matches', 'virtual_pvp_banks', 'virtual_pvp_holds', 'flag_tote_rounds', 'flag_tote_tickets', 'flag_tote_reservations'].map(table => game.prepare(
      'SELECT to_jsonb(s) AS row FROM ' + identifier(table) + ' s ORDER BY to_jsonb(s)::text').all()));
    const protectedRows = await sourcesSnapshot();
    const live = await applyAuditCleanup(audit, { ...cleanup, expectedSha256: manifest.sha256 });
    assert.equal(live.status, 'complete');
    assert.notEqual(live.liveDatasetId, testDataset.datasetId);
    assert.deepEqual(await sourcesSnapshot(), protectedRows);
    await assert.rejects(readFile(testExport), { code: 'ENOENT' });
    for (const item of manifest.rows) {
      assert.equal(await audit.prepare('SELECT 1 FROM ' + identifier(item.table) + ' WHERE dataset_id=? LIMIT 1')
        .get(testDataset.datasetId), undefined);
    }
    assert.equal((await applyAuditCleanup(audit, { ...cleanup, expectedSha256: manifest.sha256 })).liveDatasetId, live.liveDatasetId);

    assert.equal((await expand(moves.at(-1)!)).replayed, true);
    assert.equal((await bank.pvpFinish(player, { matchId: match, winnerId: player, reason: 'win' })).replayed, true);
    assert.equal((await pool.bet(ticketOwner, repeatTicket)).replayed, true);
    assert.deepEqual(await sourcesSnapshot(), protectedRows);
    assert.equal(await audit.prepare('SELECT 1 FROM audit_posting_refs WHERE dataset_id=?').get(live.liveDatasetId), undefined);
    runtime = startAuditAttemptRuntime({ ...observerEnv, ROYAL_AUDIT_LIVE_DATASET_ID: live.liveDatasetId }, game.schema);
    assert(runtime?.recordToteAdmission);
    pool.setAdmissionObserver(runtime.recordToteAdmission);
    assert.equal((await pool.bet(ticketOwner, repeatTicket)).replayed, true);
    pool.setAdmissionObserver(undefined);
    assert.deepEqual(await sourcesSnapshot(), protectedRows);
    const newOperation = { id: randomUUID(), kind: 'play', gameId: 'royal-plinko', amount: 1,
      input: { rows: 12, risk: 'easy' }, rulesVersion: 1, stakePolicyVersion: 1 };
    const play = () => send<Awaited<ReturnType<typeof wallet.operate>>>(auditCommandRoutes.core, newOperation);
    const played = await play();
    assert.deepEqual(await play(), played);
    const liveClock = Date.now(), newMatch = await beginMatch(liveClock);
    await pvp.adjudicate(a.roomId, newMatch, player, 'win', liveClock + 3);
    await stopObserver();
    const liveRefs = await audit.prepare('SELECT operation_id FROM audit_posting_refs WHERE dataset_id=? ORDER BY source_row_id')
      .all(live.liveDatasetId);
    assert.deepEqual(liveRefs.map(row => row.operation_id), [newOperation.id, newOperation.id,
      'pvp:' + newMatch + ':hold', 'pvp:' + newMatch + ':hold', 'pvp:' + newMatch + ':final']);
    const liveAttempts = await audit.prepare("SELECT payload->'scope' AS scope,payload->>'operationId' AS operation_id FROM audit_evidence WHERE dataset_id=?")
      .all(live.liveDatasetId);
    assert.equal(liveAttempts.length, 2);
    assert(liveAttempts.every(row => row.scope.environment === 'live' && row.operation_id === newOperation.id));

    await grant(live.liveDatasetId);
    const liveExport = join(filesRoot, 'live.csv');
    assert.equal((await exportAuditPlayer(reader, reportInput(live.liveDatasetId, live.liveStartedAtMs, liveExport))).rowCount, 4);
    const liveCsv = await readFile(liveExport, 'utf8');
    assert(liveCsv.includes(newOperation.id) && liveCsv.includes(newMatch));
    for (const old of [testDataset.datasetId, roundId, match, round.id, ...tickets.map(ticket => ticket.id)]) {
      assert(!liveCsv.includes(old));
    }
    const summary = await readAuditSummary(reader, { schema: audit.schema, datasetId: live.liveDatasetId, filters: period(live.liveStartedAtMs) });
    assert.equal(summary.environment, 'live');
    assert.equal(summary.scanned, 5);
    assert.deepEqual([...new Set(summary.rows.map(row => row.category))].sort(), ['casino', 'pvp']);
    assert.equal(summary.rows.find(row => row.category === 'pvp' && row.movement_type === 'fee')?.fee_units, '100');
    const detail = (datasetId: string, postingId: string) => readAuditDetail(reader,
      { schema: audit.schema, datasetId, filters: { source: namespace, postingId } });
    for (const anchor of [casinoAnchor, matchAnchor, ticketAnchor]) {
      assert.equal((await detail(live.liveDatasetId, anchor.rowId)).status, 'not-captured');
    }
    assert.equal((await detail(live.liveDatasetId, (await capture(newOperation.id)).rowId)).status, 'found');
    await assert.rejects(detail(testDataset.datasetId, casinoAnchor.rowId), { code: 'permission-denied' });
  });
