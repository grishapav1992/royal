import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AuditDatasets } from '../server/audit/datasets';
import { verifyReplayPackage } from '../server/audit/replay-package';
import { AuditReplayStore } from '../server/audit/replay-store';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditReplayReport } from '../server/audit/report-replay-source';
import { identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { FlagToteStore } from '../server/flagTote';
import { TOTE_TIMING } from '../src/shared/flagTote';

const run = promisify(execFile);
const prepareScript = fileURLToPath(new URL('../scripts/audit-replay-prepare.ts', import.meta.url));
const reportScript = fileURLToPath(new URL('../scripts/audit.ts', import.meta.url));

test('dedicated worker prepares immutable casino and pool replays for the restricted operator CLI', async t => {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-replay-prepare-'));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12), password = randomUUID();
  const worker = 'audit_prepare_worker_' + suffix, reader = 'audit_prepare_reader_' + suffix, operator = 'audit_prepare_operator_' + suffix;
  await audit.exec(`CREATE ROLE ${identifier(worker)} LOGIN PASSWORD '${password}';
    CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
    CREATE ROLE ${identifier(reader)} NOLOGIN; GRANT ${identifier(reader)} TO ${identifier(operator)};
    ALTER ROLE ${identifier(worker)} SET temp_file_limit='32MB';
    ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB'`);
  t.after(async () => {
    await audit.exec(`DROP OWNED BY ${identifier(worker)},${identifier(reader)};
      DROP ROLE ${identifier(worker)},${identifier(operator)},${identifier(reader)}`);
    await Promise.all([audit.close(), game.close(), rm(directory, { recursive: true, force: true })]);
  });
  const url = (name: string) => `postgresql://${name}:${password}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
  const workerFile = join(directory, 'worker-url'), operatorFile = join(directory, 'operator-url');
  await writeFile(workerFile, url(worker), { mode: 0o600 });
  await writeFile(operatorFile, url(operator), { mode: 0o600 });

  const actor = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?)').run(actor);
  const wallet = new DemoWalletStore(game, () => 0);
  await wallet.operate(actor, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId, environment } = await datasets.startTest();
  const scope = { datasetId, environment };
  const schema = identifier(audit.schema), gameSchema = identifier(game.schema), workerRole = identifier(worker);
  await audit.exec(`GRANT USAGE ON SCHEMA ${schema},${gameSchema} TO ${workerRole};
    GRANT SELECT ON ALL TABLES IN SCHEMA ${gameSchema} TO ${workerRole};
    GRANT SELECT ON ${schema}.audit_datasets,${schema}.audit_dataset_sources,${schema}.audit_posting_refs,
      ${schema}.audit_opening_obligations,${schema}.audit_evidence,${schema}.audit_replay_packages,${schema}.audit_replay_fragments TO ${workerRole};
    GRANT UPDATE(id) ON ${schema}.audit_datasets TO ${workerRole};
    GRANT INSERT ON ${schema}.audit_replay_packages,${schema}.audit_replay_fragments TO ${workerRole}`);
  assert.equal((await audit.prepare("SELECT has_table_privilege(?,?,'INSERT') AS allowed")
    .get(worker, game.schema + '.demo_ledger'))?.allowed, false);
  await installAuditReportAccess(audit, reader);
  await installAuditReplayReport(audit, reader, { game: game.schema });
  await audit.prepare('INSERT INTO audit_report_acl(operator_name,dataset_id,source_namespace) VALUES (?,?,?)')
    .run(operator, datasetId, game.schema + '.demo_ledger');

  const operationId = randomUUID();
  await wallet.operate(actor, { id: operationId, kind: 'play', gameId: 'royal-roulette', input: { bet: 'black' },
    rulesVersion: 1, stakePolicyVersion: 1, amount: 1 });
  const posting = (await game.prepare("SELECT id::text FROM demo_ledger WHERE operation_id=? AND entry_type='bet'").get(operationId))!.id;
  let now = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period;
  const tote = new FlagToteStore(game, account => wallet.snapshotInTransaction(account), wallet.ready, () => now, () => 0);
  const pool = (await tote.snapshot(actor)).round;
  await tote.bet(actor, { id: randomUUID(), roundId: pool.id, rulesVersion: 1, country: 'FR', stakeUnits: '100' });
  now = pool.closesAt;
  await tote.advance();
  const ledgerBefore = await game.prepare('SELECT count(*) AS n FROM demo_ledger').get();

  const env = { ...process.env, ROYAL_AUDIT_WORKER_DB_URL_FILE: workerFile, ROYAL_AUDIT_DB_URL_FILE: operatorFile };
  const execute = (script: string, args: string[], environment = env) =>
    run(process.execPath, ['--import', 'tsx', script, ...args], { env: environment, timeout: 15_000 });
  const prepare = (selected: string, replayId: string, ...selection: string[]) => execute(prepareScript,
    ['--schema', audit.schema, '--game-schema', game.schema, '--dataset', selected, '--replay', replayId, ...selection]);
  const replayId = randomUUID(), poolReplayId = randomUUID();
  assert.deepEqual(JSON.parse((await prepare(datasetId, replayId, '--posting', posting)).stdout),
    { status: 'stored', coverage: 'complete', replayId });
  assert.deepEqual(JSON.parse((await prepare(datasetId, replayId, '--posting', posting)).stdout),
    { status: 'stored', coverage: 'complete', replayId });
  await assert.rejects(prepare(datasetId, replayId, '--pool', pool.id),
    (error: { code: number; stdout: string }) => error.code === 1 && JSON.parse(error.stdout).reason === 'conflict');
  assert.deepEqual(JSON.parse((await prepare(datasetId, poolReplayId, '--pool', pool.id)).stdout),
    { status: 'stored', coverage: 'partial', replayId: poolReplayId });

  const destination = join(directory, 'replay.json');
  await execute(reportScript, ['replay', '--schema', audit.schema, '--dataset', datasetId, '--replay', replayId, '--output', destination]);
  const exported: unknown = JSON.parse(await readFile(destination, 'utf8'));
  assert.equal(verifyReplayPackage(exported).status, 'verified');
  const stored = await new AuditReplayStore(audit).read(scope, poolReplayId);
  assert.equal(stored.status, 'verified');
  assert.equal(stored.value.manifest.entityId, pool.id);
  assert.deepEqual(await game.prepare('SELECT count(*) AS n FROM demo_ledger').get(), ledgerBefore);

  const noWorkerFile = { ...env, ROYAL_AUDIT_WORKER_DB_URL_FILE: '', DATABASE_URL: url(worker) };
  await assert.rejects(execute(prepareScript, ['--schema', audit.schema, '--game-schema', game.schema, '--dataset', datasetId,
    '--replay', randomUUID(), '--posting', posting], noWorkerFile),
  (error: { code: number; stderr: string }) => error.code === 2 && !error.stderr.includes(password));
  await assert.rejects(prepare(datasetId, randomUUID(), '--posting', posting, '--pool', pool.id), { code: 2 });

  await datasets.sealTest(datasetId);
  await assert.rejects(prepare(datasetId, randomUUID(), '--posting', posting),
    (error: { code: number; stdout: string }) => error.code === 1 && JSON.parse(error.stdout).reason === 'active-test-dataset-required');
  const live = randomUUID();
  await audit.prepare("INSERT INTO audit_datasets(id,environment,started_at_ms) VALUES (?,'live',0)").run(live);
  await audit.prepare('INSERT INTO audit_dataset_sources VALUES (?,?)').run(live, game.schema + '.demo_ledger');
  await assert.rejects(prepare(live, randomUUID(), '--posting', posting),
    (error: { code: number; stdout: string }) => error.code === 1 && JSON.parse(error.stdout).reason === 'active-test-dataset-required');
});
