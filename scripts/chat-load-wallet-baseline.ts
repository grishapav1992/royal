import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import { databaseConfig, PostgresDatabase } from '../server/database';
import { verifyGameRound } from '../server/games/core';
import type { WalletResult } from '../src/shared/demoWallet';
import type { GamePlayRequest, RouletteRound } from '../src/shared/gameCore';
import { CLUB_FINE_SOURCE, type ClubFineReceipt, type ClubFineRequest, type ClubFineResponse } from '../src/shared/security';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

const databaseName = 'royal_chat_load_game';
const freshRate = 25;
const replayRate = 2;
const rate = freshRate + replayRate;
const intervalMs = 1000 / rate;
const funding = 100;
const fundingCents = funding * 100;
const stakeCents = 10;
const maxInFlight = 128;
const requestTimeoutMs = 5000;
const shutdownTimeoutMs = 5000;
const killTimeoutMs = 2000;

class BaselineError extends Error {}
function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new BaselineError(code);
}

function requireWalletOwner() {
  requireCondition(process.connected && process.send, 'owned_wallet_server_required');
}

function options(args: string[]) {
  const allowed = ['--run-id', '--phase', '--duration-seconds', '--output', '--start-at-ms'];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    requireCondition(allowed.includes(key) && value && !values.has(key), 'invalid_arguments');
    values.set(key, value);
  }
  const runId = values.get('--run-id');
  const output = values.get('--output');
  const phase = values.get('--phase') ?? 'baseline';
  const durationSeconds = Number(values.get('--duration-seconds') ?? 1800);
  const startAt = values.has('--start-at-ms') ? Number(values.get('--start-at-ms')) : undefined;
  requireCondition(runId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId)
    && output && ['baseline', 'chat-on'].includes(phase)
    && Number.isSafeInteger(durationSeconds) && durationSeconds >= 1 && durationSeconds <= 1800
    && (startAt === undefined || Number.isSafeInteger(startAt) && startAt > Date.now() && startAt <= Date.now() + 15 * 60000),
  'invalid_arguments');
  return { runId, output, phase, durationSeconds, startAt };
}

async function authorizeStand(runId: string) {
  const env = process.env, port = Number(env.PGPORT), pool = Number(env.PGPOOL_MAX ?? 10);
  requireCondition(env.NODE_ENV === 'test' && env.PGHOST === '127.0.0.1'
    && env.PGDATABASE === databaseName && env.PGUSER === databaseName && env.PGSSLMODE === 'disable'
    && env.PGPASSWORD && Number.isSafeInteger(port) && port > 0 && port <= 65535
    && Number.isSafeInteger(pool) && pool >= 1 && pool <= 50
    && !['DATABASE_URL', 'DATABASE_URL_FILE', 'PGPASSWORD_FILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS',
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_USE_ENV_PROXY'].some(key => env[key]),
  'isolated_game_database_required');
  const isolatedEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'test', AUTH_DB_PATH: 'royal_game', PGHOST: '127.0.0.1', PGPORT: String(port),
    PGDATABASE: databaseName, PGUSER: databaseName, PGPASSWORD: env.PGPASSWORD, PGSSLMODE: 'disable',
    PGPOOL_MAX: String(pool), PGAPPNAME: 'royal/chat-load-wallet', PGCONNECT_TIMEOUT_MS: '3000',
    PGSTATEMENT_TIMEOUT_MS: '3000', PGLOCK_TIMEOUT_MS: '2000',
  };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (env[key]) isolatedEnv[key] = env[key];
  }
  const probe = new pg.Client(databaseConfig(isolatedEnv));
  try {
    await probe.connect();
    const result = await probe.query(`
      SELECT current_database() AS db, current_user AS role, current_setting('royal.chat_load_run_id', true) AS marker,
        NOT pg_is_in_recovery() AS primary,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'royal_game' AND nspowner = current_user::regrole) AS owned_schema`);
    const row = result.rows[0];
    requireCondition(row.db === databaseName && row.role === databaseName && row.marker === runId && row.primary && row.owned_schema,
      'stand_database_identity_mismatch');
  } finally { await probe.end(); }

  // The application singleton is initialized after this guard. No payment, provider or production config is inherited.
  process.env = isolatedEnv;
}

type Fixture = { accountId: string; token: string; depositId: string };
type Roulette = { kind: 'roulette'; fixture: Fixture; request: GamePlayRequest; round?: RouletteRound };
type Fine = { kind: 'fine'; fixture: Fixture; request: ClubFineRequest; receipt?: ClubFineReceipt; originalReplies: number };
type Operation = Roulette | Fine;
type Attempt = { operation: Operation; replay: boolean };
type AccountStore = import('../server/accounts').AccountStore;

function fixture(): Fixture {
  return { accountId: randomUUID(), token: randomBytes(32).toString('hex'), depositId: randomUUID() };
}

async function seedFixtures(store: AccountStore, fixtures: Fixture[]) {
  requireWalletOwner();
  const db = store.financeAdmin.db;
  const rows = JSON.stringify(fixtures.map(({ accountId, token }) => ({
    id: accountId, session_hash: createHash('sha256').update(token).digest('hex'),
  })));
  const now = Date.now();
  await db.transaction(async () => {
    requireWalletOwner();
    await db.prepare(`INSERT INTO accounts (id,email,name,password,skin,created_at)
      SELECT id, id || '@load.invalid', 'Synthetic wallet load', 'disabled', 0, ?
      FROM jsonb_to_recordset(?::jsonb) AS rows(id text, session_hash text)`).run(now, rows);
    requireWalletOwner();
    await db.prepare(`INSERT INTO sessions (hash,account_id,expires)
      SELECT session_hash,id,? FROM jsonb_to_recordset(?::jsonb) AS rows(id text, session_hash text)`).run(now + 3600000, rows);
  }, { lockKey: 'chat-load-wallet-fixtures' });
  for (let index = 0; index < fixtures.length; index += 8) {
    requireWalletOwner();
    await Promise.all(fixtures.slice(index, index + 8).map(({ accountId, depositId }) =>
      store.wallet.operate(accountId, { id: depositId, kind: 'deposit', amount: funding })));
  }
}

function roulette(fixture: Fixture): Roulette {
  return {
    kind: 'roulette', fixture,
    request: { id: randomUUID(), kind: 'play', gameId: 'royal-roulette', rulesVersion: 1,
      stakePolicyVersion: 1, input: { bet: 'red' }, amount: stakeCents / 100 },
  };
}

async function prepareFines(store: AccountStore, fixtures: Fixture[], firstAt: number) {
  const fines: Fine[] = [];
  for (let index = 0; index < fixtures.length; index += 8) {
    requireWalletOwner();
    const batch = await Promise.all(fixtures.slice(index, index + 8).map(async (fixture, offset): Promise<Fine> => {
      // Align the synthetic offence time with the planned slot, so first fines remain payable throughout a long run.
      const { outcome: { sanction } } = await store.clubSanctions.recordViolation(fixture.accountId,
        { id: randomUUID(), reason: 'spam', equippedSkinId: null }, firstAt + (index + offset) * 1000);
      requireCondition(sanction.amountCents === 1000 && sanction.revision === 1, 'invalid_fine_fixture');
      return { kind: 'fine', fixture, request: { id: randomUUID(), sanctionId: sanction.id,
        revision: sanction.revision, amountCents: sanction.amountCents }, originalReplies: 0 };
    }));
    fines.push(...batch);
  }
  return fines;
}

function plan(rouletteFixtures: Fixture[], fines: Fine[]) {
  let nextRoulette = 0;
  const attempts: Attempt[] = [];
  for (const fine of fines) {
    const repeatedRound = roulette(rouletteFixtures[nextRoulette++ % rouletteFixtures.length]);
    for (let slot = 0; slot < rate; slot++) {
      if (slot === 0 || slot === 12) attempts.push({ operation: repeatedRound, replay: slot === 12 });
      else if (slot === 1 || slot === 13) attempts.push({ operation: fine, replay: slot === 13 });
      else attempts.push({ operation: roulette(rouletteFixtures[nextRoulette++ % rouletteFixtures.length]), replay: false });
    }
  }
  return attempts;
}

function compareResponse(operation: Operation, payload: unknown) {
  if (operation.kind === 'roulette') {
    const result = payload as WalletResult;
    const round = result?.gameRound;
    requireCondition(verifyGameRound(round) && round.gameId === 'royal-roulette'
      && round.stakeUnits === String(stakeCents) && round.input.bet === 'red', 'invalid_roulette_receipt');
    requireCondition(result.wallet?.entries.filter(entry => entry.operationId === operation.request.id && entry.kind === 'bet'
      && entry.source === 'royal-roulette' && entry.amount === -stakeCents / 100).length === 1, 'invalid_roulette_wallet_receipt');
    if (operation.round) requireCondition(JSON.stringify(operation.round) === JSON.stringify(round), 'changed_roulette_replay');
    operation.round = round;
    return;
  }
  const result = payload as ClubFineResponse;
  requireCondition(result?.status === 'paid' && result.sanction === null && typeof result.replayed === 'boolean'
    && result.receipt.id === operation.request.id && result.receipt.sanctionId === operation.request.sanctionId
    && result.receipt.amountCents === operation.request.amountCents && result.receipt.revision === operation.request.revision
    && Number.isSafeInteger(result.receipt.paidAt), 'invalid_fine_receipt');
  if (operation.receipt) requireCondition(JSON.stringify(operation.receipt) === JSON.stringify(result.receipt), 'changed_fine_replay');
  operation.receipt = result.receipt;
  if (!result.replayed) operation.originalReplies++;
}

type Send = (operation: Operation, dropReply?: boolean) => Promise<void>;

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted.length ? Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(3)) : null;
  return { samples: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: at(1) };
}

async function measure(attempts: Attempt[], startAt: number | undefined, send: Send, signal: AbortSignal) {
  const inFlight = new Set<Promise<void>>();
  const samples: Record<string, number[]> = { roulette: [], rouletteReplay: [], fine: [], fineReplay: [] };
  const dispatchLag: number[] = [], errors: Record<string, number> = {};
  let missed = 0, dispatched = 0, fresh = 0, replayed = 0, peakInFlight = 0;
  const delay = startAt === undefined ? 0 : startAt - Date.now();
  requireCondition(delay >= 0, 'scheduled_start_missed');
  const start = performance.now() + delay;
  try {
    for (let index = 0; index < attempts.length; index++) {
      const due = start + index * intervalMs;
      while (performance.now() < due) await pause(Math.max(1, Math.ceil(due - performance.now())), undefined, { signal });
      signal.throwIfAborted();
      const sent = performance.now();
      if (sent - due >= intervalMs || inFlight.size >= maxInFlight) { missed++; continue; }
      dispatchLag.push(sent - due);
      const { operation, replay } = attempts[index];
      const key = operation.kind + (replay ? 'Replay' : '');
      dispatched++;
      if (replay) replayed++;
      else fresh++;
      const pending = send(operation).then(() => { samples[key].push(performance.now() - sent); }, error => {
        const reason = error instanceof BaselineError ? error.message : 'transport_failure';
        errors[reason] = (errors[reason] ?? 0) + 1;
      });
      inFlight.add(pending);
      void pending.then(() => inFlight.delete(pending));
      peakInFlight = Math.max(peakInFlight, inFlight.size);
    }
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    await Promise.all(inFlight);
  }
  signal.throwIfAborted();
  const sent = Object.values(samples).flat();
  const seconds = attempts.length / rate;
  return { planned: attempts.length, dispatched, fresh, replayed, missed, completed: sent.length, errors,
    offeredOpsPerSecond: dispatched / seconds, freshOpsPerSecond: fresh / seconds, replayOpsPerSecond: replayed / seconds,
    dispatchLag: percentiles(dispatchLag),
    latency: percentiles(sent), byOperation: Object.fromEntries(Object.entries(samples).map(([key, value]) => [key, percentiles(value)])),
    peakInFlight };
}

type ExpectedEntry = { accountId: string; source: string; entries: [string, number][] };

async function audit(db: PostgresDatabase, fixtures: Fixture[], operations: Operation[]) {
  const ids = fixtures.map(({ accountId }) => accountId);
  const expected = new Map<string, ExpectedEntry>();
  const operationCount = new Map<string, Operation>();
  for (const { accountId, depositId } of fixtures) {
    expected.set(depositId, { accountId, source: 'royal-coins', entries: [['deposit', fundingCents]] });
  }
  for (const operation of operations) {
    const { fixture: { accountId }, request: { id } } = operation;
    operationCount.set(id, operation);
    if (operation.kind === 'roulette') {
      requireCondition(operation.round, 'missing_roulette_result');
      expected.set(id, { accountId, source: 'royal-roulette', entries: [['bet', -stakeCents], ['win', Number(operation.round.payoutUnits)]] });
    } else {
      requireCondition(operation.receipt && operation.originalReplies === 1, 'missing_or_duplicate_fine_result');
      expected.set(CLUB_FINE_SOURCE + ':' + id, { accountId, source: CLUB_FINE_SOURCE, entries: [['bet', -operation.request.amountCents]] });
    }
  }
  const [ledger, wallets, receipts, fineReceipts] = await Promise.all([
    db.prepare(`SELECT account_id,operation_id,source,entry_type,amount_units,balance_units FROM demo_ledger
      WHERE account_id=ANY(?::text[]) ORDER BY account_id,id`).all(ids),
    db.prepare('SELECT account_id,balance*100+fraction_units AS cents FROM demo_wallets WHERE account_id=ANY(?::text[])').all(ids),
    db.prepare('SELECT account_id,operation_id,amount_units,kind,result FROM demo_operations WHERE account_id=ANY(?::text[])').all(ids),
    db.prepare('SELECT account_id,operation_id,episode_id,revision,amount_cents,paid_at FROM club_fine_payments WHERE account_id=ANY(?::text[])').all(ids),
  ]);
  const balances = new Map<string, number>();
  for (const row of ledger) {
    const entry = expected.get(row.operation_id);
    const next = entry?.entries.shift();
    requireCondition(entry && entry.accountId === row.account_id && entry.source === row.source
      && next?.[0] === row.entry_type && next?.[1] === Number(row.amount_units), 'unexpected_ledger_entry');
    const balance = (balances.get(row.account_id) ?? 0) + Number(row.amount_units);
    requireCondition(balance === Number(row.balance_units), 'ledger_running_balance_mismatch');
    balances.set(row.account_id, balance);
    if (!entry.entries.length) expected.delete(row.operation_id);
  }
  requireCondition(!expected.size && wallets.length === fixtures.length
    && wallets.every(row => balances.get(row.account_id) === Number(row.cents)), 'wallet_ledger_mismatch');
  const depositIds = new Map(fixtures.map(item => [item.depositId, item.accountId]));
  const receiptDigest = createHash('sha256');
  for (const row of receipts.sort((left, right) => String(left.operation_id).localeCompare(String(right.operation_id)))) {
    if (row.kind === 'deposit') {
      requireCondition(depositIds.get(row.operation_id) === row.account_id && Number(row.amount_units) === fundingCents, 'unexpected_deposit_receipt');
      depositIds.delete(row.operation_id);
      continue;
    }
    const operation = operationCount.get(row.operation_id);
    requireCondition(row.kind === 'play' && Number(row.amount_units) === stakeCents && operation?.kind === 'roulette'
      && operation.fixture.accountId === row.account_id
      && JSON.stringify(JSON.parse(row.result).gameRound) === JSON.stringify(operation.round), 'unexpected_roulette_receipt');
    operationCount.delete(row.operation_id);
    receiptDigest.update(JSON.stringify([row.operation_id, operation.round]) + '\n');
  }
  for (const row of fineReceipts.sort((left, right) => String(left.operation_id).localeCompare(String(right.operation_id)))) {
    const operation = operationCount.get(row.operation_id);
    requireCondition(operation?.kind === 'fine' && operation.fixture.accountId === row.account_id
      && operation.receipt && operation.receipt.sanctionId === row.episode_id && operation.receipt.revision === Number(row.revision)
      && operation.receipt.amountCents === Number(row.amount_cents) && operation.receipt.paidAt === Number(row.paid_at), 'unexpected_fine_receipt');
    operationCount.delete(row.operation_id);
    receiptDigest.update(JSON.stringify([row.operation_id, operation.receipt]) + '\n');
  }
  requireCondition(!depositIds.size && !operationCount.size, 'missing_wallet_receipt');
  return { fixtureAccounts: fixtures.length, fundingCentsPerAccount: fundingCents, ledgerRows: ledger.length,
    paidRoundReceipts: receipts.length - fixtures.length, finePaymentReceipts: fineReceipts.length,
    balanceCents: [...balances.values()].reduce((sum, balance) => sum + balance, 0), receiptDigest: receiptDigest.digest('hex') };
}

type Config = ReturnType<typeof options>;
type ServerMessage =
  | { kind: 'ready'; port: number; dropToken: string; rouletteFixtures: Fixture[]; fines: Fine[];
    recoveryRound: Roulette; recoveryFine: Fine; fixtures: Fixture[] }
  | { kind: 'dropped'; payload: unknown }
  | { kind: 'measuring' }
  | { kind: 'metrics'; peakPoolWaiting: number; peakPoolConnections: number; poolMax: number | undefined };

function receive<K extends ServerMessage['kind']>(child: ChildProcess, signal: AbortSignal, kind: K, timeoutMs = 5000) {
  return new Promise<Extract<ServerMessage, { kind: K }>>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', failed);
      child.off('message', message);
    };
    const failed = () => { cleanup(); reject(signal.reason); };
    const message = (value: unknown) => {
      const packet = value as ServerMessage;
      if (packet?.kind === kind) { cleanup(); resolve(packet as Extract<ServerMessage, { kind: K }>); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new BaselineError('wallet_server_timeout')); }, timeoutMs);
    signal.addEventListener('abort', failed, { once: true });
    child.on('message', message);
  });
}

function startWalletProcess(args: string[]) {
  const child = fork(fileURLToPath(import.meta.url), ['--wallet-server', ...args], {
    execArgv: ['--import', 'tsx'], env: process.env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true,
  });
  const lifetime = new AbortController();
  let closing = false, stopped: Promise<void> | undefined;
  const fail = (reason: string) => lifetime.abort(new BaselineError(reason));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.on('error', () => {
      fail('wallet_server_process_error');
      if (child.pid === undefined) resolve({ code: null, signal: null });
    });
    child.once('exit', (code, signal) => {
      if (!closing) fail('wallet_server_exited');
      resolve({ code, signal });
    });
  });
  child.once('disconnect', () => { if (!closing) fail('wallet_server_disconnected'); });

  async function waitForExit(milliseconds: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), milliseconds); });
    try { return await Promise.race([exited, deadline]); }
    finally { clearTimeout(timer); }
  }

  async function stop() {
    closing = true;
    try { if (child.connected) child.disconnect(); }
    catch { fail('wallet_server_disconnect_failed'); }
    const exit = await waitForExit(shutdownTimeoutMs);
    if (!exit) {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      requireCondition(await waitForExit(killTimeoutMs), 'wallet_server_cleanup_unconfirmed');
      throw new BaselineError('wallet_server_shutdown_timeout');
    }
    lifetime.signal.throwIfAborted();
    requireCondition(exit.code === 0 && exit.signal === null && !child.connected, 'wallet_server_shutdown_failed');
  }
  return { child, signal: lifetime.signal, stop: () => stopped ??= stop() };
}

async function serveWallet(config: Config) {
  requireWalletOwner();
  const parentClosed = once(process, 'disconnect');
  const emit = (packet: ServerMessage) => { if (process.connected) process.send?.(packet); };
  await authorizeStand(config.runId);
  requireWalletOwner();
  const { accounts } = await import('../server/accounts');
  const [{ installDemoWallet }, { installClubFineRoutes }] = await Promise.all([
    import('../server/demoWalletRoutes'), import('../server/clubFineRoutes'),
  ]);
  const app = express();
  const dropToken = randomUUID();
  app.use((req, res, next) => {
    if (req.get('x-royal-load-drop') === dropToken) {
      const json = res.json.bind(res);
      res.json = payload => {
        if (res.statusCode !== 200) return json(payload);
        // The route completed before the network reply was dropped.
        emit({ kind: 'dropped', payload });
        res.destroy();
        return res;
      };
    }
    next();
  });
  installDemoWallet(app);
  installClubFineRoutes(app);
  let server: Server | undefined;
  let sampler: ReturnType<typeof setInterval> | undefined;
  try {
    await accounts.ready;
    requireWalletOwner();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    requireWalletOwner();
    const address = server.address();
    requireCondition(address && typeof address !== 'string' && address.address === '127.0.0.1', 'invalid_wallet_listener');
    const rouletteFixtures = Array.from({ length: 128 }, fixture);
    const fineFixtures = Array.from({ length: config.durationSeconds }, fixture);
    const recoveryRound = roulette(fixture());
    const recoveryFineFixture = fixture();
    const fixtures = [...rouletteFixtures, ...fineFixtures, recoveryRound.fixture, recoveryFineFixture];
    await seedFixtures(accounts, fixtures);
    const fines = await prepareFines(accounts, fineFixtures, config.startAt ?? Date.now());
    const [recoveryFine] = await prepareFines(accounts, [recoveryFineFixture], Date.now());
    requireWalletOwner();
    let peakPoolWaiting = 0, peakPoolConnections = 0;
    const { pool } = accounts.financeAdmin.db;
    const sample = () => {
      peakPoolWaiting = Math.max(peakPoolWaiting, pool.waitingCount);
      peakPoolConnections = Math.max(peakPoolConnections, pool.totalCount);
    };
    process.on('message', command => {
      if (command === 'measure' && !sampler) {
        sample();
        sampler = setInterval(sample, 50);
        emit({ kind: 'measuring' });
      } else if (command === 'metrics') {
        clearInterval(sampler);
        sample();
        emit({ kind: 'metrics', peakPoolWaiting, peakPoolConnections, poolMax: pool.options.max });
      }
    });
    emit({ kind: 'ready', port: address.port, dropToken, rouletteFixtures, fines, recoveryRound, recoveryFine, fixtures });
    await parentClosed;
  } finally {
    clearInterval(sampler);
    await Promise.all([new Promise<void>((resolve, reject) => {
      if (!server) { resolve(); return; }
      server.close(error => error ? reject(new BaselineError('wallet_listener_shutdown_failed')) : resolve());
      server.closeAllConnections();
    }), accounts.close()]);
  }
}

async function main() {
  const serverMode = process.argv[2] === '--wallet-server';
  const args = process.argv.slice(serverMode ? 3 : 2);
  const config = options(args);
  const startedAt = new Date().toISOString();
  if (serverMode) {
    await serveWallet(config);
    return;
  }
  await authorizeStand(config.runId);
  const { child, signal, stop } = startWalletProcess(args);
  try {
    const { port, dropToken, rouletteFixtures, fines, recoveryRound, recoveryFine, fixtures } = await receive(child, signal, 'ready', 300000);
    requireCondition(Number.isSafeInteger(port) && port > 0 && port <= 65535, 'invalid_wallet_listener');
    const origin = 'http://127.0.0.1:' + port;
    const send: Send = async (operation, dropReply = false) => {
      const path = operation.kind === 'roulette' ? '/api/demo-wallet/operations' : '/api/demo-wallet/club-fine';
      const dropped = dropReply ? receive(child, signal, 'dropped').catch(() => undefined) : undefined;
      const result = await fetch(origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
        headers: { Origin: origin, Cookie: 'royal_session=' + operation.fixture.token,
          [WALLET_ACCOUNT_HEADER]: operation.fixture.accountId, 'Content-Type': 'application/json',
          ...(dropReply ? { 'x-royal-load-drop': dropToken } : {}) }, body: JSON.stringify(operation.request) }).catch(error => {
        if (!dropReply || !(error instanceof TypeError)) throw error;
        return undefined;
      });
      if (dropReply) {
        signal.throwIfAborted();
        requireCondition(!result, 'expected_dropped_reply');
        const packet = await dropped;
        requireCondition(packet, 'drop_before_wallet_commit');
        compareResponse(operation, packet.payload);
        return;
      }
      requireCondition(result, 'missing_wallet_response');
      if (!result.ok) {
        await result.body?.cancel();
        throw new BaselineError('wallet_http_' + result.status);
      }
      compareResponse(operation, await result.json());
    };
    for (const operation of [recoveryRound, recoveryFine]) {
      await send(operation, true);
      await send(operation);
    }

    const attempts = plan(rouletteFixtures, fines);
    const measuring = receive(child, signal, 'measuring');
    child.send('measure');
    await measuring;
    const measured = await measure(attempts, config.startAt, send, signal);
    const metricsResult = receive(child, signal, 'metrics');
    child.send('metrics');
    const { kind: _kind, ...poolMetrics } = await metricsResult;
    await stop();
    const providedProfile = measured.dispatched === measured.planned && measured.completed === measured.planned;
    let audited: Awaited<ReturnType<typeof audit>> | null = null, auditError: string | null = null;
    const db = new PostgresDatabase('royal_game', { readOnly: true });
    try {
      const operations = [...new Set(attempts.map(({ operation }) => operation)), recoveryRound, recoveryFine];
      audited = await audit(db, fixtures, operations);
    } catch (error) {
      auditError = error instanceof BaselineError ? error.message : 'audit_failed';
    } finally { await db.close(); }
    const passed = providedProfile && audited !== null;
    const externalChatWorkloadLabel = config.phase === 'chat-on';
    const report = { format: 1, ...config, output: undefined, startedAt, completedAt: new Date().toISOString(),
      rate, expectedFreshOpsPerSecond: freshRate, expectedReplayOpsPerSecond: replayRate, expectedAuditCoverage: 1,
      openLoop: true, separateWalletProcess: true, walletServerCleanExit: true, externalChatWorkloadLabel,
      chatTrafficGeneratedOrVerified: false,
      exactStakeCents: stakeCents, maxInFlight, requestTimeoutMs, poolMetrics,
      measured, ledger: audited, auditError, lostReplyRecovery: { roulette: true, fine: true }, passed };
    await writeFile(config.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ passed, phase: config.phase, externalChatWorkloadLabel, ...measured, ledger: audited, auditError }));
    if (!passed) process.exitCode = 1;
  } finally {
    await stop().catch(() => { /* Preserve the primary failure after bounded cleanup. */ });
  }
}

void main().catch(error => {
  console.error('Chat wallet baseline failed:', error instanceof BaselineError ? error.message : 'unexpected_failure');
  process.exitCode = 1;
});
