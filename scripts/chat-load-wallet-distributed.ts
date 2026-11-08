import pg from 'pg';
import { localChatLoadHostId, readPrivateChatLoadManifest } from './chat-load-distributed-stand';

export const walletGameRole = 'royal_chat_load_game';
const maxLifetimeMs = 4 * 60 * 60 * 1_000;
const minDiskBytes = 5 * 1024 ** 3;
const hex64 = /^[a-f0-9]{64}$/;
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const systemId = /^[1-9][0-9]{0,19}$/;

export type WalletGameIdentity = { hostId: string; systemIdentifier: string };
export type WalletProfile = { durationSeconds: number; authorizationRate: number };
export type WalletPhase = 'baseline' | 'chat-on';
type WalletManifest = { phase: WalletPhase; runId: string; expiresAtUnixMs: number; generatorHostId: string;
  game: { port: number; hostId: string; freeDiskBytes: number }; systemIdentifier: string; password: string; profile: WalletProfile };

export class DistributedWalletError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'DistributedWalletError'; }
}
function fail(code: string): never { throw new DistributedWalletError(code); }

function exact(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) fail('wallet-stand-invalid-manifest');
  return value as Record<string, unknown>;
}
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);

export function parseWalletGameIdentity(hostId: unknown, systemIdentifier: unknown): WalletGameIdentity {
  if (!matches(hostId, hex64) || !matches(systemIdentifier, systemId) || BigInt(systemIdentifier) > (1n << 64n) - 1n) {
    fail('wallet-stand-invalid-game-identity');
  }
  return { hostId, systemIdentifier };
}

function parseManifest(value: unknown, phase: WalletPhase, generator: string, now: number): WalletManifest {
  const manifest = exact(value, ['format', 'purpose', 'phase', 'runId', 'expiresAtUnixMs', 'generatorHostId', 'game',
    'systemIdentifier', 'password', 'profile']);
  const { format, purpose, runId, expiresAtUnixMs, generatorHostId, password } = manifest;
  const { port, hostId, freeDiskBytes } = exact(manifest.game, ['port', 'hostId', 'freeDiskBytes']);
  const { systemIdentifier } = parseWalletGameIdentity(hostId, manifest.systemIdentifier);
  const { durationSeconds, authorizationRate } = exact(manifest.profile, ['durationSeconds', 'authorizationRate']);
  if (format !== 1 || purpose !== 'royal-chat-load-wallet-distributed' || manifest.phase !== phase
    || !matches(runId, uuidV4) || !matches(password, hex64) || !matches(generatorHostId, hex64) || generatorHostId !== generator
    || !matches(hostId, hex64) || hostId === generator || !integer(port, 1_024, 65_535) || !integer(freeDiskBytes, minDiskBytes, Number.MAX_SAFE_INTEGER)
    || !integer(durationSeconds, 1, 1_800) || !integer(authorizationRate, 1, 333)) fail('wallet-stand-invalid-manifest');
  const requiredMs = durationSeconds * (phase === 'baseline' ? 1_000 : 2_000);
  if (!integer(expiresAtUnixMs, now + requiredMs + 1, now + maxLifetimeMs)) fail('wallet-stand-invalid-expiry');
  return { phase, runId, expiresAtUnixMs, generatorHostId, game: { port, hostId, freeDiskBytes }, systemIdentifier, password,
    profile: { durationSeconds, authorizationRate } };
}

export function parseWalletManifestPair(baseline: unknown, chatOn: unknown, generatorHostId: string, now = Date.now()) {
  const a = parseManifest(baseline, 'baseline', generatorHostId, now), b = parseManifest(chatOn, 'chat-on', generatorHostId, now);
  if (a.runId === b.runId || a.systemIdentifier === b.systemIdentifier || a.game.port === b.game.port || a.password === b.password
    || a.game.hostId !== b.game.hostId || a.profile.durationSeconds !== b.profile.durationSeconds
    || a.profile.authorizationRate !== b.profile.authorizationRate) fail('wallet-stand-unmatched-phases');
  return [a, b] as const;
}

export async function readDistributedWalletManifests(baselinePath: string, chatOnPath: string) {
  try {
    const [baseline, chatOn, generatorHostId] = await Promise.all([
      readPrivateChatLoadManifest(baselinePath), readPrivateChatLoadManifest(chatOnPath), localChatLoadHostId(),
    ]);
    return parseWalletManifestPair(baseline, chatOn, generatorHostId);
  } catch (error) {
    if (error instanceof DistributedWalletError) throw error;
    fail('wallet-stand-private-linux-manifests-required');
  }
}

/** Called on the preflight socket and again on the wallet process before initializing the app. */
export async function attestWalletGameIdentity(client: Pick<pg.Client, 'query'>, runId: string, identity: WalletGameIdentity,
  readOnly: boolean) {
  try {
    const { rows: [row], rowCount } = await client.query(`
      SELECT session_user::text AS login, current_user::text AS role, current_database() AS database,
        current_setting('royal.chat_load_run_id',true) AS marker, current_setting('royal.chat_load_node_id',true) AS host_id,
        system_identifier::text AS system_identifier, pg_is_in_recovery() AS recovery,
        current_setting('transaction_read_only') AS read_only, current_setting('fsync') AS fsync,
        current_setting('synchronous_commit') AS commit_mode, current_setting('synchronous_standby_names') AS standbys,
        current_setting('server_version_num')::int AS version, current_setting('max_connections')::int AS connections,
        current_setting('superuser_reserved_connections')::int + current_setting('reserved_connections')::int AS reserved,
        current_setting('shared_buffers') AS shared_buffers, current_setting('wal_level') AS wal_level,
        EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=current_user::regrole) AS owns_database,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres',$1)) AS isolated_cluster,
        (SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
          FROM pg_catalog.pg_roles WHERE rolname=current_user) AS unprivileged,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
          OR rolname IN ('pg_read_all_data','pg_write_all_data','pg_execute_server_program','pg_read_server_files',
            'pg_write_server_files','pg_signal_backend'))
          AND pg_has_role(current_user,oid,'MEMBER')) AS no_server_privileges,
        EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='royal_game' AND nspowner=current_user::regrole) AS owns_schema,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('royal_game','public')) AS fresh_schema
      FROM pg_catalog.pg_control_system()`, [walletGameRole]);
    if (rowCount !== 1 || row.login !== walletGameRole || row.role !== walletGameRole || row.database !== walletGameRole
      || row.marker !== runId || row.host_id !== identity.hostId || row.system_identifier !== identity.systemIdentifier
      || row.recovery !== false || row.read_only !== (readOnly ? 'on' : 'off') || row.fsync !== 'on' || row.commit_mode !== 'on'
      || row.standbys !== '' || row.owns_database !== true || row.isolated_cluster !== true || row.unprivileged !== true
      || row.no_server_privileges !== true || row.owns_schema !== true) fail('wallet-stand-game-identity-mismatch');
    if (row.fresh_schema !== true) fail('wallet-stand-game-schema-not-fresh');
    if (!integer(row.version, 170000, 179999) || !integer(row.connections, 60, 10_000)
      || !integer(row.reserved, 0, row.connections - 16) || !matches(row.shared_buffers, /^\d+[A-Z]*$/i)
      || !matches(row.wal_level, /^(?:minimal|replica|logical)$/)) fail('wallet-stand-game-settings-mismatch');
    return { version: row.version, maxConnections: row.connections, reservedConnections: row.reserved,
      sharedBuffers: row.shared_buffers, walLevel: row.wal_level, fsync: true, synchronousCommit: true };
  } catch (error) {
    if (error instanceof DistributedWalletError) throw error;
    fail('wallet-stand-game-attestation-failed');
  }
}

/** Hold one read-only PostgreSQL session per phase to exclude another runner of the same manifest. */
export async function lockDistributedWalletGame(manifest: WalletManifest, signal?: AbortSignal) {
  if (signal?.aborted) fail('wallet-stand-interrupted');
  if (Date.now() >= manifest.expiresAtUnixMs) fail('wallet-stand-expired');
  const client = new pg.Client({ host: '127.0.0.1', port: manifest.game.port, user: walletGameRole, database: walletGameRole,
    password: manifest.password, ssl: false, connectionTimeoutMillis: 3_000, statement_timeout: 4_000, query_timeout: 5_000,
    application_name: 'royal/chat-wallet-attestation', options: '-c default_transaction_read_only=on -c search_path=pg_catalog' });
  const lifetime = new AbortController();
  const lost = () => lifetime.abort(new DistributedWalletError('wallet-stand-forward-lost'));
  client.on('error', lost);
  client.on('end', lost);
  const expiry = setTimeout(() => lifetime.abort(new DistributedWalletError('wallet-stand-expired')), Math.max(1, manifest.expiresAtUnixMs - Date.now()));
  expiry.unref();
  const close = async () => {
    clearTimeout(expiry);
    await client.end();
  };
  try {
    await client.connect();
    const identity = { hostId: manifest.game.hostId, systemIdentifier: manifest.systemIdentifier };
    await attestWalletGameIdentity(client, manifest.runId, identity, true);
    const { rows: [lease] } = await client.query("SELECT pg_try_advisory_lock(hashtextextended('royal/chat-wallet-ab',0)) AS acquired");
    if (lease?.acquired !== true) fail('wallet-stand-phase-in-use');
    const settings = await attestWalletGameIdentity(client, manifest.runId, identity, true);
    if (signal?.aborted) fail('wallet-stand-interrupted');
    lifetime.signal.throwIfAborted();
    return { stand: { runId: manifest.runId, game: { port: manifest.game.port, role: walletGameRole, password: manifest.password }, identity },
      settings, signal: lifetime.signal, close };
  } catch (error) {
    await close().catch(() => {});
    if (error instanceof DistributedWalletError) throw error;
    fail('wallet-stand-game-attestation-failed');
  }
}
