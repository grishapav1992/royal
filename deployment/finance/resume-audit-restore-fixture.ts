import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import pg from 'pg';
import { startAuditAttemptRuntime } from '../../server/audit/attempts';
import { isAuditRecord } from '../../server/audit/contract';
import { auditHttpAttempts } from '../../server/audit/http-attempts';
import { auditCommandRoutes } from '../../server/audit/intents';
import { databaseConfig, PostgresDatabase } from '../../server/database';
import { DemoWalletStore } from '../../server/demoWallet';
import { demoBalanceUnits } from '../../server/demoWalletAmounts';
import { CARIBBEAN_GAME } from '../../src/shared/caribbeanTreasures';

const port = process.argv[2];
const password = process.env.ROYAL_AUDIT_RESTORE_FIXTURE_PASSWORD;
assert.equal(process.env.NODE_ENV, 'test');
assert(port && /^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535);
assert(password && /^[a-f0-9]{64}$/.test(password));
const config = databaseConfig({
  PGHOST: '127.0.0.1', PGPORT: port, PGDATABASE: 'royal_finance_sim',
  PGUSER: 'finance_schema_owner', PGPASSWORD: password, PGSSLMODE: 'disable',
});
const admin = new pg.Pool(config);
const files = await mkdtemp(join(tmpdir(), 'royal-audit-restored-recorder-'));
let runtime: ReturnType<typeof startAuditAttemptRuntime>;
let game: PostgresDatabase | undefined;
let server: Server | undefined;
try {
  const { rows: [fixture] } = await admin.query(`SELECT current_setting('royal.audit_restore_fixture',true) AS marker,
    version FROM royal_finance.meta`);
  assert.deepEqual(fixture, { marker: 'restored', version: 3 });
  const { rows: datasets } = await admin.query<{ id: string }>(`SELECT id::text FROM royal_audit.audit_datasets
    WHERE environment='test' AND sealed_at_ms IS NULL`);
  const { rows: requests } = await admin.query<{ account_id: string; id: string; request_key: string }>(
    `SELECT account_id,id,request_key FROM royal_game.demo_casino_requests WHERE request_key::jsonb->>'gameId'=$1`,
    [CARIBBEAN_GAME]);
  assert.equal(datasets.length, 1);
  assert.equal(requests.length, 1);
  const [{ id: datasetId }] = datasets;
  const [{ account_id: account, id: operationId, request_key: request }] = requests;
  assert.equal(JSON.parse(request).id, operationId);
  const gamePassword = randomBytes(32).toString('hex'), recorderPassword = randomBytes(32).toString('hex');
  await admin.query('ALTER ROLE royal_game_app PASSWORD ' + pg.escapeLiteral(gamePassword));
  await admin.query('ALTER ROLE royal_audit_recorder PASSWORD ' + pg.escapeLiteral(recorderPassword));
  const credential = join(files, 'recorder-url');
  const url = new URL('postgresql://127.0.0.1/royal_finance_sim');
  url.port = port;
  url.username = 'royal_audit_recorder';
  url.password = recorderPassword;
  await writeFile(credential, url.toString() + '\n', { mode: 0o600, flag: 'wx' });
  runtime = startAuditAttemptRuntime({ NODE_ENV: 'production', ROYAL_AUDIT_SCHEMA: 'royal_audit',
    ROYAL_AUDIT_TEST_DATASET_ID: datasetId, ROYAL_AUDIT_RECORDER_DB_URL_FILE: credential }, 'royal_game');
  assert(runtime && await runtime.ready);

  game = new PostgresDatabase('royal_game', { existingSchema: true,
    config: { ...config, user: 'royal_game_app', password: gamePassword } });
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  const postings = game.prepare(`SELECT id::text,entry_type,amount_units::text FROM demo_ledger
    WHERE account_id=? AND operation_id=? ORDER BY id`);
  const before = await postings.all(account, operationId);
  assert.equal(before.length, 1);
  assert.equal(before[0].entry_type, 'bet');
  const balance = await demoBalanceUnits(game, account);

  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.use((_req, res, next) => { res.locals.accountId = account; next(); });
  app.use(auditHttpAttempts(attempt => runtime?.record(attempt), { gameSchema: game.schema }));
  app.post(auditCommandRoutes.expansion, async (req, res) => { res.json(await wallet.expansion.operate(account, req.body)); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
  const response = await fetch('http://127.0.0.1:' + address.port + auditCommandRoutes.expansion, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: request,
  });
  assert.equal(response.status, 200);
  const reply = await response.json() as Awaited<ReturnType<typeof wallet.expansion.operate>>;
  assert.equal(reply.replayed, true);
  assert.equal(reply.session.id, operationId);
  assert.equal(reply.wallet.balance, balance / 100);
  assert.deepEqual(await postings.all(account, operationId), before);
  assert.equal(await demoBalanceUnits(game, account), balance);
  await runtime.close();
  runtime = undefined;

  const { rows: attempts } = await admin.query<{ payload: unknown }>(
    "SELECT payload FROM royal_audit.audit_evidence WHERE dataset_id=$1 AND kind='attempt'", [datasetId]);
  assert.equal(attempts.length, 1);
  const { payload } = attempts[0];
  assert(isAuditRecord(payload) && payload.type === 'attempt');
  assert.equal(payload.operationId, operationId);
  assert.equal(payload.decision, 'replayed');
  assert.deepEqual(payload.balance, { state: 'value', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 },
    units: String(balance), snapshot: { namespace: 'royal_game.demo_ledger', rowId: before[0].id } });
  console.log(JSON.stringify({ exactRetry: true, recordedAttempts: 1, walletUnchanged: true, auditedBalanceMatches: true }));
} finally {
  try {
    if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await runtime?.close();
  } finally {
    await Promise.all([game?.close(), admin.end(), rm(files, { recursive: true, force: true })]);
  }
}
