import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { buildCapturedCasinoReplay } from '../server/audit/replay-casino';
import { persistCapturedChessReplay } from '../server/audit/replay-chess-storage';
import { createReplayPackage, type ReplayPackage, type ReplayState } from '../server/audit/replay-package';
import { chessTurnReplayDefinition, ChessTurnReplayCapture, type CapturedChessReplay } from '../server/audit/replay-pvp-turn';
import { tsuTurnReplayDefinition } from '../server/audit/replay-pvp-tsu';
import { AuditReplayStore } from '../server/audit/replay-store';
import { persistCapturedToteReplay } from '../server/audit/replay-tote';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { exportAuditReplay, type ReplayReportFilters } from '../server/audit/report-replay';
import { installAuditReplayReport } from '../server/audit/report-replay-source';
import { ChessGame } from '../server/chessGame';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { FlagToteStore } from '../server/flagTote';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { prepareViewerReplay } from '../src/audit/replay-viewer-model';
import { TOTE_TIMING } from '../src/shared/flagTote';

test('named operators export only authorized canonical replay packages and journal verification outcomes', async t => {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const scratch = await mkdtemp(join(tmpdir(), 'royal-audit-replay-report-'));
  const operators: PostgresDatabase[] = [];
  t.after(async () => {
    await Promise.all([game.close(), audit.close(), ...operators.map(operator => operator.close())]);
    await rm(scratch, { recursive: true, force: true });
  });

  const accounts = [randomUUID(), randomUUID()];
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(...accounts);
  const wallet = new DemoWalletStore(game, () => 0);
  const ledger = new VirtualPvpLedger(game, wallet), pvp = new PvpStore(ledger);
  const combat = new NileCombatEscrow(ledger);
  await Promise.all([wallet.ready, pvp.ready, combat.ready]);
  for (const accountId of accounts) await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const scope = await datasets.startTest().then(({ datasetId, environment }) => ({ datasetId, environment }));
  const { datasetId } = scope, schema = audit.schema, a = identifier(schema);
  const demo = game.schema + '.demo_ledger', pending = game.schema + '.capro_pending_ledger';
  const suffix = randomUUID().slice(0, 8), group = 'replay_reader_' + suffix;
  const alice = 'replay_alice_' + suffix, bob = 'replay_bob_' + suffix;
  const password = randomUUID();
  await audit.exec(`CREATE ROLE ${group} NOLOGIN;
    CREATE ROLE ${alice} LOGIN PASSWORD '${password}'; CREATE ROLE ${bob} LOGIN PASSWORD '${password}';
    GRANT ${group} TO ${alice},${bob}; ALTER ROLE ${alice} SET temp_file_limit='64MB'; ALTER ROLE ${bob} SET temp_file_limit='64MB'`);
  await installAuditReportAccess(audit, group);
  await installAuditDetailReport(audit, group, { game: game.schema });
  await installAuditReplayReport(audit, group, { game: game.schema });
  await audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?),(?,?,?)').run(alice, datasetId, demo, bob, datasetId, pending);
  const login = (name: string) => databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '', PGUSER: name,
    PGPASSWORD: password, PGPASSWORD_FILE: '' });
  const raw = (name: string) => {
    const db = new PostgresDatabase(schema, { existingSchema: true, config: login(name) });
    operators.push(db);
    return db;
  };
  const aliceDb = raw(alice), bobDb = raw(bob);
  const begin = (db: PostgresDatabase, selector: string | ReplayReportFilters, dataset = datasetId) => db.prepare(
    `SELECT ${a}.audit_report_begin(?,'replay',?::jsonb) AS id`)
    .get(dataset, JSON.stringify(typeof selector === 'string' ? { replayId: selector } : selector)).then(row => row!.id as string);
  const read = (db: PostgresDatabase, job: string) => db.prepare(`SELECT ${a}.audit_report_replay(?) AS replay`)
    .get(job).then(row => row!.replay as unknown);
  const cancel = (db: PostgresDatabase, job: string) => db.prepare(
    `SELECT ${a}.audit_report_finish(?,'cancelled',0,0,'cancelled')`).get(job);
  const run = (name: string, replayId: string, file: string, dataset = datasetId) =>
    exportAuditReplay(login(name), { schema, datasetId: dataset, filters: { replayId }, destination: join(scratch, file) });
  const runEntity = (name: string, filters: ReplayReportFilters, file: string, dataset = datasetId) =>
    exportAuditReplay(login(name), { schema, datasetId: dataset, filters, destination: join(scratch, file) });
  const replayStore = new AuditReplayStore(audit);
  const persist = async (pack: ReplayPackage, headerOnly = false) => {
    assert.equal(await replayStore.writeManifest(pack.manifest), 'recorded');
    if (!headerOnly) for (const fragment of pack.fragments) assert.equal(await replayStore.writeFragment(scope, pack.manifest.replayId, fragment), 'recorded');
  };
  const playId = randomUUID();
  await wallet.operate(accounts[0], { id: playId, kind: 'play', gameId: 'royal-roulette', input: { bet: 'black' },
    amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 });
  const stake = (await game.prepare("SELECT id::text FROM demo_ledger WHERE operation_id=? AND entry_type='bet'").get(playId))!.id;
  const built = await buildCapturedCasinoReplay(audit, { datasetId, gameSchema: game.schema, replayId: randomUUID(),
    posting: { namespace: demo, rowId: stake } });
  assert.equal(built.status, 'built');
  if (built.status !== 'built') return;
  const manifest = built.value.manifest;
  const legacyEvents = built.value.fragments.flatMap(fragment => fragment.events).map(({ money, calculation, ...event }) => event);
  const legacy = (replayId = randomUUID(), entityId = playId, events = legacyEvents) => createReplayPackage({
    formatVersion: 1, scope, replayId, entityId, game: manifest.game, initial: manifest.initial,
    coverage: 'complete', gaps: [],
  }, events);
  const original = legacy();
  await persist(original);

  await t.test('publishes legacy and pinned formats as offline viewer JSON, preserves the test marker and never overwrites', async () => {
    const first = await run(alice, original.manifest.replayId, 'legacy.json');
    const output = join(scratch, 'legacy.json');
    const before = await readFile(output, 'utf8');
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(before), original);
    assert.equal(prepareViewerReplay(JSON.parse(before)).status, 'ready');
    assert.equal(first.engineVerified, false);
    assert.equal(first.environment, 'test');
    assert.equal(first.rowCount, 2);
    assert.equal(first.bytes, Buffer.byteLength(before));
    assert.deepEqual(await audit.prepare('SELECT operator_name,kind,status,row_count,byte_count FROM audit_export_jobs WHERE id=?').get(first.jobId),
      { operator_name: alice, kind: 'replay', status: 'succeeded', row_count: 2, byte_count: first.bytes });
    await assert.rejects(run(alice, original.manifest.replayId, 'legacy.json'), { code: 'output-error' });
    assert.equal(await readFile(output, 'utf8'), before);

    const now = Date.now(), actors = accounts.map(accountId => ({
      accountId, name: 'fixture player', roomId: 'report-replay', connected: true, available: true,
    }));
    await pvp.syncRoom(actors[0].roomId, actors, now);
    const match = (await pvp.command(actors[0], { id: randomUUID(), action: 'create', gameId: 'chess',
      stakeUnits: '1000000', targetId: accounts[1] }, now)).active!.id;
    await pvp.command(actors[1], { id: randomUUID(), action: 'accept', challengeId: match }, now + 1);
    await pvp.command(actors[0], { id: randomUUID(), action: 'ready', challengeId: match }, now + 2);
    const ready = (await pvp.command(actors[1], { id: randomUUID(), action: 'ready', challengeId: match }, now + 3)).active!;
    let at = 10, recording: CapturedChessReplay | undefined;
    const engine = new ChessGame(undefined, () => at);
    const capture = new ChessTurnReplayCapture(id => id, value => { recording = value; }, () => at);
    capture.observeMatches([ready]);
    engine.setReplayObserver(value => capture.observeEngine(value));
    for (const id of accounts) assert(engine.join(id));
    at += 100;
    assert(engine.move(accounts[0], 'e2', 'e4', undefined));
    assert(engine.resign(accounts[1]));
    await pvp.adjudicate(actors[0].roomId, match, accounts[0], 'win', now + 100);
    capture.observeAdjudication(match, accounts[0], 'win', now + 100);
    assert.ok(recording);
    assert.equal(await persistCapturedChessReplay(audit, scope, game.schema, recording), 'recorded');
    const pinned = await run(alice, match, 'chess.json');
    const chessSelector = { gameId: 'chess', entityKind: 'match', entityId: match } as const;
    const byMatch = await runEntity(alice, chessSelector, 'by-match.json');
    assert.equal(byMatch.replayId, match);
    assert.deepEqual(await readFile(join(scratch, 'by-match.json')), await readFile(join(scratch, 'chess.json')));
    await rm(join(scratch, 'by-match.json'));
    const packageFile = JSON.parse(await readFile(join(scratch, 'chess.json'), 'utf8')) as ReplayPackage;
    assert.equal(pinned.engineVerified, true);
    assert.equal(packageFile.manifest.scope.environment, 'test');
    const readyViewer = prepareViewerReplay(packageFile);
    assert.equal(readyViewer.status, 'ready');
    if (readyViewer.status === 'ready') assert.equal(readyViewer.engineVerified, true);
    const { formatVersion, game: definition, initial, coverage, gaps } = packageFile.manifest;
    const inconsistent = createReplayPackage({ formatVersion, scope, replayId: randomUUID(), entityId: match,
      game: definition, initial, coverage, gaps }, packageFile.fragments.flatMap(fragment => fragment.events).map(event =>
      event.data.kind === 'terminal' ? { ...event, data: { ...event.data, winnerSeat: 2 } } : event));
    await persist(inconsistent);
    await assert.rejects(run(alice, inconsistent.manifest.replayId, 'inconsistent.json'), { code: 'replay-corrupt' });
    await assert.rejects(runEntity(alice, chessSelector, 'duplicate-match.json'), { code: 'replay-ambiguous' });

    let poolClock = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period;
    const tote = new FlagToteStore(game, account => wallet.snapshotInTransaction(account), wallet.ready, () => poolClock, () => 0);
    const round = (await tote.snapshot(accounts[0])).round;
    for (const [account, country] of [[accounts[0], 'FR'], [accounts[1], 'BR'], [accounts[0], 'DE']]) {
      await tote.bet(account, { id: randomUUID(), roundId: round.id, rulesVersion: 1, country, stakeUnits: '100' });
    }
    poolClock = round.finishesAt;
    await tote.advance();
    const toteReplay = randomUUID();
    assert.equal((await persistCapturedToteReplay(audit, { datasetId, gameSchema: game.schema, poolId: round.id,
      replayId: toteReplay })).status, 'stored');
    const poolResult = await run(alice, toteReplay, 'tote.json');
    const poolPackage = JSON.parse(await readFile(join(scratch, 'tote.json'), 'utf8'));
    assert.equal(poolResult.engineVerified, false);
    assert.equal(poolPackage.manifest.formatVersion, 3);
    assert.equal(poolPackage.manifest.entityId, round.id);
    assert.equal(prepareViewerReplay(poolPackage).status, 'ready');
    const byPool = await runEntity(alice, { gameId: 'flag-tote', entityKind: 'round', entityId: round.id }, 'by-pool.json');
    assert.equal(byPool.replayId, toteReplay);
    assert.deepEqual(await readFile(join(scratch, 'by-pool.json')), await readFile(join(scratch, 'tote.json')));
    await rm(join(scratch, 'by-pool.json'));
  });

  await t.test('selects an exact dataset, game and round without revealing packages outside operator grants', async () => {
    const selector = { gameId: 'royal-roulette', entityKind: 'round', entityId: playId } as const;
    const byRound = await runEntity(alice, selector, 'by-round.json');
    assert.notEqual(byRound.replayId, playId);
    assert.deepEqual(await readFile(join(scratch, 'by-round.json')), await readFile(join(scratch, 'legacy.json')));
    await rm(join(scratch, 'by-round.json'));
    const absent = { code: 'replay-absent' };
    await assert.rejects(runEntity(alice, { ...selector, gameId: 'royal-blackjack' }, 'other-game.json'), absent);
    await assert.rejects(runEntity(alice, { ...selector, entityKind: 'match' }, 'wrong-kind.json'), absent);
    await assert.rejects(runEntity(bob, selector, 'without-grant.json'), absent);
    await assert.rejects(runEntity(alice, selector, 'other-dataset.json', randomUUID()), { code: 'permission-denied' });
    const foreign = randomUUID();
    await audit.prepare("INSERT INTO audit_datasets VALUES(?,'test',0,1)").run(foreign);
    await audit.prepare('INSERT INTO audit_dataset_sources VALUES(?,?)').run(foreign, demo);
    await audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(alice, foreign, demo);
    await assert.rejects(runEntity(alice, selector, 'empty-dataset.json', foreign), absent);
    for (const invalid of [
      { ...selector, replayId: original.manifest.replayId },
      { ...selector, gameId: 'ROYAL-ROULETTE' },
      { ...selector, entityKind: 'match', entityId: 'ft1-42' },
    ] as const) await assert.rejects(begin(aliceDb, invalid), { code: '22023' });
  });

  await t.test('requires a committed owned job and a live grant for each captured posting source', async () => {
    await assert.rejects(aliceDb.prepare(`SELECT manifest FROM ${a}.audit_replay_packages`).get(), { code: '42501' });
    await assert.rejects(aliceDb.transaction(async () => {
      const uncommitted = await begin(aliceDb, original.manifest.replayId);
      return read(aliceDb, uncommitted);
    }), { code: '42501' });
    const own = await begin(aliceDb, original.manifest.replayId);
    try {
      await assert.rejects(aliceDb.prepare(`SELECT ${a}.audit_report_replay_projection(?::uuid)`).get(own), { code: '42501' });
      await assert.rejects(read(bobDb, own), { code: '42501' });
      await assert.rejects(aliceDb.transaction(() => read(aliceDb, own), { readOnly: true }), { code: '42501' });
    } finally { await cancel(aliceDb, own); }

    for (const replayId of [original.manifest.replayId, randomUUID()]) {
      const job = await begin(bobDb, replayId);
      try { assert.deepEqual(await read(bobDb, job), { status: 'absent' }); }
      finally { await cancel(bobDb, job); }
    }
    const foreign = randomUUID();
    await audit.prepare("INSERT INTO audit_datasets VALUES(?,'test',0,1)").run(foreign);
    await audit.prepare('INSERT INTO audit_dataset_sources VALUES(?,?)').run(foreign, demo);
    await assert.rejects(begin(aliceDb, original.manifest.replayId, foreign), { code: '42501' });

    const id = (await game.prepare(`INSERT INTO capro_pending_ledger
      (account_id,operation_id,amount_units,pending_balance_units,reason,created_at)
      VALUES (?,?,'1','1','credit',?) RETURNING id::text`).get(accounts[0], randomUUID(), Date.now()))!.id;
    const crossEvents = legacyEvents.map((event, index) => index === 0
      ? { ...event, postings: [...event.postings, { namespace: pending, rowId: id }] } : event);
    const mixed = legacy(randomUUID(), playId, crossEvents);
    await persist(mixed);
    await assert.rejects(runEntity(alice, { gameId: 'royal-roulette', entityKind: 'round', entityId: playId },
      'hidden-duplicate.json'), { code: 'replay-absent' });
    const job = await begin(aliceDb, mixed.manifest.replayId);
    try {
      assert.deepEqual(await read(aliceDb, job), { status: 'absent' });
      await audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(alice, datasetId, pending);
      assert.equal((await read(aliceDb, job) as { status: string }).status, 'candidate');
      await audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?').run(alice, datasetId, pending);
      assert.deepEqual(await read(aliceDb, job), { status: 'absent' });
    } finally { await cancel(aliceDb, job); }

    const detached = legacy();
    await persist(detached);
    await audit.prepare(`UPDATE audit_replay_fragments SET fragment=jsonb_set(fragment,'{events,0,money}',?::jsonb)
      WHERE dataset_id=? AND replay_id=?`).run(
      JSON.stringify([{ movement: 'payout', units: '1', posting: { namespace: pending, rowId: id } }]),
      datasetId, detached.manifest.replayId);
    const detachedJob = await begin(aliceDb, detached.manifest.replayId);
    try { assert.deepEqual(await read(aliceDb, detachedJob), { status: 'absent' }); }
    finally { await cancel(aliceDb, detachedJob); }
  });

  await t.test('the named operator CLI rejects a valid package with an unpinned engine', async () => {
    const matchId = randomUUID(), replayId = randomUUID();
    await ledger.pvpHold(accounts[0], { matchId, gameId: 'tsu-e-fa', stakeUnits: '100000' });
    const held = await game.prepare("SELECT id::text FROM demo_ledger WHERE operation_id=? AND source='pvp:tsu-e-fa'")
      .get('pvp:' + matchId + ':hold');
    assert.ok(held);
    const posting = { namespace: demo, rowId: held.id as string };
    const { formatVersion: _, ...definition } = tsuTurnReplayDefinition;
    const initial = { profile: 'pvp-turn-based', phase: 'open', turn: 1, seatToMove: null,
      board: [1, 0, 0, 0, 0, 0, 0, 0, 0] } satisfies ReplayState;
    const pack = createReplayPackage({ formatVersion: 2, scope, replayId, entityId: matchId,
      game: { ...definition, engineId: 'unreleased-tsu-engine' }, initial, coverage: 'partial', gaps: ['terminal-unavailable'],
    }, [{ sequence: 1, atMs: 0, postings: [posting], money: [{ posting, movement: 'reserve', units: '-10' }],
      data: { kind: 'checkpoint', state: initial } }]);
    await persist(pack);
    const operatorFile = join(scratch, 'operator-url');
    const destination = join(scratch, 'unpinned.json');
    const config = login(alice), url = new URL('postgresql://localhost');
    url.hostname = config.host!;
    url.port = String(config.port);
    url.pathname = '/' + encodeURIComponent(config.database!);
    url.username = alice;
    url.password = password;
    await writeFile(operatorFile, url.toString() + '\n', { mode: 0o600, flag: 'wx' });
    let jobId: string | undefined;
    try {
      await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx',
        fileURLToPath(new URL('../scripts/audit.ts', import.meta.url)), 'replay', '--schema', schema,
        '--dataset', datasetId, '--game', 'tsu-e-fa', '--match', matchId, '--output', destination], {
        env: { ...process.env, ROYAL_AUDIT_DB_URL_FILE: operatorFile, ROYAL_AUDIT_PGSSLMODE: 'disable' }, timeout: 15_000,
      }), (error: { code: number; stderr: string }) => {
        assert.equal(error.code, 1);
        const report = JSON.parse(error.stderr);
        assert.equal(report.error, 'replay-unsupported');
        jobId = report.jobId;
        return true;
      });
    } finally {
      await rm(operatorFile, { force: true });
    }
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    assert.deepEqual(await audit.prepare(
      'SELECT operator_name,status,reason,row_count,byte_count FROM audit_export_jobs WHERE id=?').get(jobId),
    { operator_name: alice, status: 'failed', reason: 'replay-unsupported', row_count: 0, byte_count: 0 });
    assert.equal(prepareViewerReplay(pack).status, 'unsupported');
  });

  await t.test('exports a recorded chess suffix as partial without a simulated result', async () => {
    const now = Date.now(), roomId = 'late-chess-replay';
    const players = [randomUUID(), randomUUID()];
    await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(...players);
    for (const accountId of players) await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
    const actors = players.map(accountId => ({ accountId, name: 'fixture player', roomId, connected: true, available: true }));
    await pvp.syncRoom(roomId, actors, now);
    const match = (await pvp.command(actors[0], { id: randomUUID(), action: 'create', gameId: 'chess',
      stakeUnits: '1000000', targetId: players[1] }, now)).active!.id;
    await pvp.command(actors[1], { id: randomUUID(), action: 'accept', challengeId: match }, now + 1);
    await pvp.command(actors[0], { id: randomUUID(), action: 'ready', challengeId: match }, now + 2);
    const ready = (await pvp.command(actors[1], { id: randomUUID(), action: 'ready', challengeId: match }, now + 3)).active!;
    let at = 10, recording: CapturedChessReplay | undefined;
    const engine = new ChessGame(undefined, () => at);
    const capture = new ChessTurnReplayCapture(id => id, value => { recording = value; }, () => at);
    engine.setReplayObserver(value => capture.observeEngine(value));
    for (const id of players) assert(engine.join(id));
    assert(engine.move(players[0], 'f2', 'f3', undefined));
    assert(engine.move(players[1], 'e7', 'e5', undefined));
    capture.observeMatches([ready]);
    at += 100;
    assert(engine.move(players[0], 'g2', 'g4', undefined));
    at += 100;
    assert(engine.move(players[1], 'd8', 'h4', undefined));
    await pvp.adjudicate(roomId, match, players[1], 'win', now + 200);
    capture.observeAdjudication(match, players[1], 'win', now + 200);
    assert(recording);
    const evidence = new AuditEvidence(audit, schema);
    const failure = {
      schemaVersion: 1, scope, occurredAtMs: now + 200, type: 'replay', replayId: 'capture-gap:' + match,
      entity: { category: 'pvp', kind: 'match', gameId: 'chess', modeId: 'stake', rulesVersion: null, ticketId: null,
        source: { namespace: game.schema + '.pvp_matches', rowId: match } },
      profile: 'pvp-turn-based', engineVersion: 'royal-chess', formatVersion: 2, coverage: 'not-recorded',
      firstSequence: null, lastSequence: null, terminalEventId: null, sha256: null,
    } as const;
    assert.equal(await evidence.record(failure), 'recorded');
    const selector = { gameId: 'chess', entityKind: 'match', entityId: match } as const;
    await assert.rejects(run(alice, match, 'gap-by-id.json'), { code: 'replay-not-recorded' });
    await assert.rejects(runEntity(alice, selector, 'gap-by-match.json'), { code: 'replay-not-recorded' });
    await assert.rejects(runEntity(alice, { ...selector, gameId: 'pool' }, 'gap-wrong-game.json'), { code: 'replay-absent' });
    await assert.rejects(runEntity(bob, selector, 'gap-without-grant.json'), { code: 'replay-absent' });
    const gapJob = await audit.prepare(`SELECT status,reason,row_count,byte_count FROM audit_export_jobs
      WHERE operator_name=? AND filters->>'entityId'=? AND reason='replay-not-recorded'`).get(alice, match);
    assert.deepEqual(gapJob, { status: 'failed', reason: 'replay-not-recorded', row_count: 0, byte_count: 0 });
    const detailInput = { schema, datasetId, filters: { source: demo, lookupKind: 'match', lookupId: match } } as const;
    const before = (await readAuditDetail(login(alice), detailInput)).coverage;
    const pendingId = (await game.prepare(`INSERT INTO capro_pending_ledger
      (account_id,operation_id,amount_units,pending_balance_units,reason,created_at)
      VALUES (?,?,'1','1','credit',?) RETURNING id::text`).get(players[1], randomUUID(), Date.now()))!.id;
    const { formatVersion, ...chessDefinition } = chessTurnReplayDefinition;
    const hiddenReplayId = randomUUID();
    const hidden = createReplayPackage({ formatVersion, game: chessDefinition, scope, replayId: hiddenReplayId,
      entityId: match, initial: recording.initial, coverage: 'partial', gaps: recording.gaps },
    recording.events.map(event => event.data.kind === 'terminal'
      ? { ...event, postings: [{ namespace: pending, rowId: pendingId }] } : event));
    await persist(hidden);
    await assert.rejects(run(alice, hiddenReplayId, 'hidden-match.json'), { code: 'replay-absent' });
    assert.deepEqual((await readAuditDetail(login(alice), detailInput)).coverage, before);
    assert.equal(before.replayCapture, 'gap-observed');

    await audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(alice, datasetId, pending);
    try {
      assert.equal((await run(alice, hiddenReplayId, 'permitted-match.json')).coverage, 'partial');
    } finally {
      await rm(join(scratch, 'permitted-match.json'), { force: true });
      await audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?')
        .run(alice, datasetId, pending);
      await audit.prepare('DELETE FROM audit_replay_fragments WHERE dataset_id=? AND replay_id=?').run(datasetId, hiddenReplayId);
      await audit.prepare('DELETE FROM audit_replay_packages WHERE dataset_id=? AND replay_id=?').run(datasetId, hiddenReplayId);
    }
    assert.equal(await persistCapturedChessReplay(audit, scope, game.schema, recording), 'recorded');
    assert.equal((await readAuditDetail(login(alice), detailInput)).coverage.replayCapture, 'gap-observed');

    const result = await runEntity(alice, selector, 'chess-partial.json');
    assert.equal(result.coverage, 'partial');
    assert.equal(result.engineVerified, false);
    const exported = JSON.parse(await readFile(join(scratch, 'chess-partial.json'), 'utf8')) as ReplayPackage;
    assert.deepEqual(exported.manifest.gaps, ['initial-state-unavailable', 'event-gap']);
    const events = exported.fragments.flatMap(fragment => fragment.events);
    assert.deepEqual(events.flatMap(event => event.money ?? []).map(leg => [leg.movement, leg.units]), [['payout', '190']]);
    const viewer = prepareViewerReplay(exported);
    assert.equal(viewer.status, 'ready');
    assert.equal(viewer.engineVerified, false);
  });

  await t.test('distinguishes absent, corrupt, incomplete and unsupported without publishing a partial file', async () => {
    const noBasis = legacy(randomUUID(), randomUUID(), legacyEvents.map(event => ({ ...event, postings: [] })));
    const incomplete = legacy();
    const corrupt = legacy();
    const unsupported = legacy();
    await persist(noBasis);
    await persist(incomplete, true);
    await persist(corrupt);
    await persist(unsupported);
    await audit.prepare(`UPDATE audit_replay_fragments SET fragment=jsonb_set(fragment,'{sha256}',to_jsonb(?::text))
      WHERE dataset_id=? AND replay_id=?`).run('0'.repeat(64), datasetId, corrupt.manifest.replayId);
    await audit.prepare(`UPDATE audit_replay_packages SET manifest=jsonb_set(manifest,'{formatVersion}','77'::jsonb)
      WHERE dataset_id=? AND replay_id=?`).run(datasetId, unsupported.manifest.replayId);
    for (const [pack, code] of [[noBasis, 'replay-absent'], [incomplete, 'replay-incomplete'],
      [corrupt, 'replay-corrupt'], [unsupported, 'replay-unsupported']] as const) {
      await assert.rejects(run(alice, pack.manifest.replayId, code + '.json'), { code });
      const row = await audit.prepare(`SELECT status,reason,row_count,byte_count FROM audit_export_jobs
        WHERE operator_name=? AND filters->>'replayId'=?`).get(alice, pack.manifest.replayId);
      assert.deepEqual(row, { status: 'failed', reason: code, row_count: 0, byte_count: 0 });
    }
    assert.deepEqual((await readdir(scratch)).sort(), ['chess-partial.json', 'chess.json', 'legacy.json', 'tote.json']);
  });
});
