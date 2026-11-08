import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const role = 'royal_chat_load_chat';
const standbyName = 'royal_chat_load_standby';
const maxManifestBytes = 8 * 1024;
const maxManifestLifetimeMs = 4 * 60 * 60 * 1_000;
const minConnections = 60;
const requiredAvailableConnections = 20; // 16 probe pool connections plus four spare.
const hex64 = /^[a-f0-9]{64}$/;
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const systemId = /^[1-9][0-9]{0,19}$/;
const lsnPattern = /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/;

type Node = { port: number; hostId: string; freeDiskBytes: number };
type Manifest = {
  runId: string; expiresAtUnixMs: number; generatorHostId: string; primary: Node; standby: Node;
  systemIdentifier: string; minimumReplayLsn: string; password: string;
};
type Connection = {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<unknown>;
};
type Connect = (config: pg.ClientConfig) => Connection;
type Common = { maxConnections: number; availableConnections: number; clientConnections: number; walSenders: number };

class DistributedChatStandError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'DistributedChatStandError'; }
}
function fail(code: string): never { throw new DistributedChatStandError(code); }

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]) {
  const parsed = record(value, 'chat-stand-invalid-manifest');
  if (Object.keys(parsed).length !== keys.length || keys.some(key => !Object.hasOwn(parsed, key))) fail('chat-stand-invalid-manifest');
  return parsed;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}
function parseNode(value: unknown): Node {
  const { port, hostId, freeDiskBytes } = exact(value, ['port', 'hostId', 'freeDiskBytes']);
  if (!integer(port, 1_024, 65_535) || !matches(hostId, hex64) || !integer(freeDiskBytes, 1, Number.MAX_SAFE_INTEGER)) {
    fail('chat-stand-invalid-manifest');
  }
  return { port, hostId, freeDiskBytes };
}
function parseManifest(value: unknown, localHostId: string): Manifest {
  const { format, purpose, runId, expiresAtUnixMs, generatorHostId, primary, standby, systemIdentifier, minimumReplayLsn, password } =
    exact(value, ['format', 'purpose', 'runId', 'expiresAtUnixMs', 'generatorHostId', 'primary', 'standby', 'systemIdentifier', 'minimumReplayLsn', 'password']);
  if (format !== 1 || purpose !== 'royal-chat-load-distributed' || !matches(runId, uuidV4)
    || !matches(generatorHostId, hex64) || !matches(systemIdentifier, systemId) || BigInt(systemIdentifier) > (1n << 64n) - 1n
    || !matches(minimumReplayLsn, lsnPattern) || walPosition(minimumReplayLsn) === 0n || !matches(password, hex64)) {
    fail('chat-stand-invalid-manifest');
  }
  const now = Date.now();
  if (!integer(expiresAtUnixMs, now + 1, now + maxManifestLifetimeMs)) fail('chat-stand-invalid-expiry');
  const primaryNode = parseNode(primary), standbyNode = parseNode(standby);
  if (generatorHostId !== localHostId || new Set([generatorHostId, primaryNode.hostId, standbyNode.hostId]).size !== 3
    || primaryNode.port === standbyNode.port) fail('chat-stand-not-distinct');
  return { runId, expiresAtUnixMs, generatorHostId, primary: primaryNode,
    standby: standbyNode, systemIdentifier, minimumReplayLsn, password };
}

export async function readPrivateChatLoadManifest(path: string): Promise<unknown> {
  if (process.platform !== 'linux' || !process.getuid || !constants.O_NOFOLLOW) fail('chat-stand-private-linux-generator-required');
  try {
    const target = resolve(path);
    if (await realpath(target) !== target) fail('chat-stand-private-manifest-required');
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid() || (before.mode & 0o077) !== 0
        || !integer(before.size, 1, maxManifestBytes)) fail('chat-stand-private-manifest-required');
      const bytes = Buffer.alloc(before.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      const after = await file.stat();
      if (size !== before.size || after.size !== before.size || after.mode !== before.mode || after.uid !== before.uid
        || after.nlink !== before.nlink || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        fail('chat-stand-private-manifest-required');
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof DistributedChatStandError) throw error;
    fail('chat-stand-private-manifest-required');
  }
}

export async function localChatLoadHostId() {
  if (process.platform !== 'linux') fail('chat-stand-generator-identity-unavailable');
  try {
    const machineId = (await readFile('/etc/machine-id', 'utf8')).trim();
    if (!/^[a-f0-9]{32}$/.test(machineId) || /^0+$/.test(machineId)) fail('chat-stand-generator-identity-unavailable');
    return createHash('sha256').update(machineId).digest('hex');
  } catch { fail('chat-stand-generator-identity-unavailable'); }
}

const identitySql = `
  SELECT session_user::text AS login, current_user::text AS role, current_database() AS database,
    current_setting('royal.chat_load_run_id', true) AS marker,
    current_setting('royal.chat_load_node_id', true) AS host_id,
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
    pg_is_in_recovery() AS recovery, current_setting('transaction_read_only') AS read_only,
    current_setting('fsync') AS fsync, current_setting('synchronous_commit') AS commit_mode,
    current_setting('synchronous_standby_names') AS standby_names, current_setting('wal_level') AS wal_level,
    current_setting('max_connections')::int AS max_connections,
    current_setting('superuser_reserved_connections')::int + coalesce(current_setting('reserved_connections', true)::int, 0) AS reserved_connections,
    current_setting('max_wal_senders')::int AS wal_senders,
    (SELECT count(*)::int FROM pg_catalog.pg_stat_activity WHERE backend_type = 'client backend') AS client_connections,
    (SELECT count(*)::int FROM pg_catalog.pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', $1)) AS unrelated_databases,
    (SELECT datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
      FROM pg_catalog.pg_database WHERE datname = current_database()) AS owns_database,
    (SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      FROM pg_catalog.pg_roles WHERE rolname = current_user) AS unprivileged,
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
      OR rolname IN ('pg_read_all_data', 'pg_write_all_data', 'pg_execute_server_program', 'pg_read_server_files',
        'pg_write_server_files', 'pg_signal_backend'))
      AND pg_has_role(current_user, oid, 'MEMBER')) AS no_server_privileges,
    pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS can_read_stats,
    (SELECT rolconnlimit FROM pg_catalog.pg_roles WHERE rolname = current_user) AS role_limit,
    (SELECT datconnlimit FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_limit`;

function walPosition(value: unknown) {
  if (!matches(value, lsnPattern)) fail('chat-stand-invalid-wal-evidence');
  const [high, low] = value.split('/');
  return (BigInt('0x' + high) << 32n) + BigInt('0x' + low);
}
function requireReached(position: unknown, minimum: bigint) {
  if (walPosition(position) < minimum) fail('chat-stand-wal-not-reached');
  return position as string;
}

function guardRun(manifest: Manifest, signal?: AbortSignal) {
  if (signal?.aborted) fail('chat-stand-interrupted');
  if (Date.now() >= manifest.expiresAtUnixMs) fail('chat-stand-expired');
}

async function one(client: Connection, sql: string, code: string, values?: unknown[]) {
  const { rows } = await client.query(sql, values);
  if (rows.length !== 1) fail(code);
  return record(rows[0], code);
}

async function attestNode<T>(manifest: Manifest, kind: 'primary' | 'standby', connect: Connect, signal: AbortSignal | undefined,
  measure: (client: Connection) => Promise<T>): Promise<Common & T> {
  let client: Connection | undefined;
  const node = manifest[kind];
  const code = `chat-stand-${kind}-attestation-failed`;
  try {
    guardRun(manifest, signal);
    client = connect({ host: '127.0.0.1', port: node.port, user: role, database: role, password: manifest.password,
      ssl: false, connectionTimeoutMillis: 3_000, statement_timeout: 4_000, query_timeout: 5_000,
      application_name: 'royal/chat-stand-attestation', options: '-c default_transaction_read_only=on -c search_path=pg_catalog' });
    await client.connect();
    guardRun(manifest, signal);
    const row = await one(client, identitySql, code, [role]);
    if (row.login !== role || row.role !== role || row.database !== role || row.marker !== manifest.runId || row.host_id !== node.hostId
      || row.system_identifier !== manifest.systemIdentifier || row.recovery !== (kind === 'standby') || row.read_only !== 'on'
      || row.fsync !== 'on' || row.commit_mode !== 'on' || (row.wal_level !== 'replica' && row.wal_level !== 'logical')
      || row.unrelated_databases !== 0 || row.owns_database !== true || row.unprivileged !== true
      || row.no_server_privileges !== true || row.can_read_stats !== true) fail(code);
    if (kind === 'primary' && row.standby_names !== `FIRST 1 (${standbyName})`) fail('chat-stand-invalid-sync-configuration');
    const { max_connections: maxConnections, client_connections: clientConnections, reserved_connections: reserved, wal_senders: walSenders } = row;
    if (!integer(maxConnections, minConnections, 65_535) || !integer(clientConnections, 1, maxConnections)
      || !integer(reserved, 0, maxConnections) || !integer(walSenders, 1, 65_535)) fail('chat-stand-insufficient-postgres-limits');
    const availableConnections = maxConnections - reserved - clientConnections;
    if (availableConnections < requiredAvailableConnections || [row.role_limit, row.database_limit].some(limit =>
      limit !== -1 && !integer(limit, requiredAvailableConnections + clientConnections, 65_535))) {
      fail('chat-stand-insufficient-postgres-limits');
    }
    const marker = await one(client, 'SELECT true AS reached FROM public.stand_probe WHERE id = $1::uuid', 'chat-stand-run-marker-missing', [manifest.runId]);
    if (marker.reached !== true) fail('chat-stand-run-marker-missing');
    const proof = await measure(client);
    guardRun(manifest, signal);
    return { maxConnections, clientConnections, availableConnections, walSenders, ...proof };
  } catch (error) {
    if (error instanceof DistributedChatStandError) throw error;
    return fail(code);
  } finally {
    if (client) {
      try { await client.end(); } catch { fail(`chat-stand-${kind}-close-failed`); }
    }
  }
}

/** Core used with an injected connector in tests. Only openDistributedChatLoadStand supplies the real connector. */
export async function attestDistributedChatLoadStand(value: unknown, localHostId: string, connect: Connect, signal?: AbortSignal) {
  const manifest = parseManifest(value, localHostId), minimum = walPosition(manifest.minimumReplayLsn);
  const [primary, standby] = await Promise.allSettled([
    attestNode(manifest, 'primary', connect, signal, async client => {
      const row = await one(client, `SELECT application_name, state, sync_state, flush_lsn::text, replay_lsn::text,
        pg_current_wal_flush_lsn()::text AS local_flush_lsn FROM pg_catalog.pg_stat_replication LIMIT 2`, 'chat-stand-replication-not-ready');
      if (row.application_name !== standbyName || row.state !== 'streaming' || row.sync_state !== 'sync') fail('chat-stand-replication-not-ready');
      return { flushLsn: requireReached(row.local_flush_lsn, minimum), replicaFlushLsn: requireReached(row.flush_lsn, minimum),
        replicaReplayLsn: requireReached(row.replay_lsn, minimum) };
    }),
    attestNode(manifest, 'standby', connect, signal, async client => {
      const row = await one(client, `SELECT status, flushed_lsn::text, pg_last_wal_receive_lsn()::text AS receive_lsn,
        pg_last_wal_replay_lsn()::text AS replay_lsn FROM pg_catalog.pg_stat_wal_receiver LIMIT 2`, 'chat-stand-replication-not-ready');
      if (row.status !== 'streaming') fail('chat-stand-replication-not-ready');
      return { flushLsn: requireReached(row.flushed_lsn, minimum), receiveLsn: requireReached(row.receive_lsn, minimum),
        replayLsn: requireReached(row.replay_lsn, minimum) };
    }),
  ]);
  if (primary.status === 'rejected') throw primary.reason;
  if (standby.status === 'rejected') throw standby.reason;
  guardRun(manifest, signal);
  return { runId: manifest.runId, expiresAtUnixMs: manifest.expiresAtUnixMs,
    primaryIdentity: { hostId: manifest.primary.hostId, systemIdentifier: manifest.systemIdentifier },
    chat: { port: manifest.primary.port, role, password: manifest.password },
    report: { topology: 'distinct_attested_machine_id_hashes', sameHost: false, separateFailureDomains: 'unverified',
      generatorHostId: manifest.generatorHostId, sharedSystemIdentifier: true, minimumReplayLsn: manifest.minimumReplayLsn,
      primary: { hostId: manifest.primary.hostId, ...primary.value }, standby: { hostId: manifest.standby.hostId, ...standby.value },
      replication: { state: 'streaming', sync_state: 'sync' },
      freeDiskBytes: Math.min(manifest.primary.freeDiskBytes, manifest.standby.freeDiskBytes),
      disk: { source: 'provisioning-manifest', sqlVerified: false,
        primaryFreeBytes: manifest.primary.freeDiskBytes, standbyFreeBytes: manifest.standby.freeDiskBytes } } };
}

export async function openDistributedChatLoadStand(manifestPath: string, signal?: AbortSignal) {
  if (signal?.aborted) fail('chat-stand-interrupted');
  const manifest = await readPrivateChatLoadManifest(manifestPath);
  const hostId = await localChatLoadHostId();
  return attestDistributedChatLoadStand(manifest, hostId, config => {
    const client = new pg.Client(config);
    client.on('error', () => { /* Each operation reports only its fixed attestation error. */ });
    return client;
  }, signal);
}
