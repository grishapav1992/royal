import { Client } from 'pg';

export const LOAD_RUN_REDIS_KEY = 'royal:lobby:load-run';
const loadRunSetting = 'royal.websocket_load_run_id';
const runIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function loadDatabaseClient(env: NodeJS.ProcessEnv, readOnly: boolean) {
  const { LOAD_LOBBY_RUN_ID: runId, PGPORT, PGPASSWORD: password } = env;
  const port = Number(PGPORT);
  if (env.NODE_ENV !== 'test' || env.PGHOST !== '127.0.0.1' || env.PGDATABASE !== 'royal_test'
    || env.PGUSER !== 'postgres' || !Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== PGPORT
    || !password || !/^[a-f0-9]{64}$/.test(password) || !runId || !runIdPattern.test(runId)) {
    throw new Error('use-temporary-postgresql-wrapper');
  }
  const client = new Client({ host: '127.0.0.1', port, database: 'royal_test', user: 'postgres', password, ssl: false,
    options: '-c search_path=pg_catalog' + (readOnly ? ' -c default_transaction_read_only=on' : ''),
    connectionTimeoutMillis: 3000, statement_timeout: 3000, query_timeout: 4000 });
  client.on('error', () => { /* Callers report only fixed setup codes. */ });
  return { client, runId };
}

async function inspectLoadDatabase(client: Client) {
  const { rows: [proof] } = await client.query<{ run_id: string | null; isolated: boolean }>(`
    SELECT current_setting($1, true) AS run_id,
      current_database() = 'royal_test' AND current_user = 'postgres' AND session_user = 'postgres'
      AND NOT pg_is_in_recovery()
      AND inet_server_addr() = '127.0.0.1'::inet AND inet_client_addr() = '127.0.0.1'::inet
      AND NOT EXISTS (SELECT 1 FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', 'royal_test'))
      AS isolated`, [loadRunSetting]);
  return proof;
}

export async function setLoadDatabaseRun(env: NodeJS.ProcessEnv): Promise<void> {
  const { client, runId } = loadDatabaseClient(env, false);
  try {
    await client.connect();
    const proof = await inspectLoadDatabase(client);
    if (proof?.isolated !== true || proof.run_id !== null) throw new Error('load-database-not-fresh');
    // The identifier is fixed and the value has already been validated as a UUID.
    await client.query(`ALTER DATABASE royal_test SET "${loadRunSetting}" TO '${runId}'`);
  } finally { await client.end(); }
}

export async function assertOwnedLoadDatabase(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { client, runId } = loadDatabaseClient(env, true);
  try {
    await client.connect();
    const proof = await inspectLoadDatabase(client);
    if (proof?.run_id !== runId || proof.isolated !== true) throw new Error('load-database-not-owned');
    return runId;
  } catch { throw new Error('load-database-not-owned'); }
  finally { await client.end().catch(() => {}); }
}
