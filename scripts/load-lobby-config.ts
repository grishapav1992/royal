import { loopbackEndpoint } from './load-stand-contract';
import { MAX_GAME_PROCESSES, standGameProcessIds } from './load-stand-limits';

export const loadLobbyWorkers = standGameProcessIds(MAX_GAME_PROCESSES);
export const loadLobbyDatabase = 'royal_test';
export const loadLobbySchema = 'royal_websocket_load';
const runIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function port(value: string | undefined) {
  const number = /^\d{1,5}$/.test(value ?? '') ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1024 || number > 65535) throw new Error('load-lobby-invalid-port');
  return number;
}

export function parseLoadLobbyConfig(env: NodeJS.ProcessEnv) {
  const { LOAD_LOBBY_RUN_ID: runId, LOBBY_WORKER_ID: workerId, REDIS_URL: redisUrl, PGPASSWORD: password } = env;
  if (env.NODE_ENV !== 'test' || env.PGHOST !== '127.0.0.1' || env.PGDATABASE !== loadLobbyDatabase || env.PGUSER !== 'postgres'
    || env.PGSSLMODE !== 'disable' || env.AUTH_DB_PATH !== loadLobbySchema || !runId || !runIdPattern.test(runId)
    || !password || !/^[a-f0-9]{64}$/.test(password)
    || ['DATABASE_URL', 'DATABASE_URL_FILE', 'PGPASSWORD_FILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS'].some(key => env[key])) {
    throw new Error('load-lobby-owned-database-required');
  }
  if (!workerId || !loadLobbyWorkers.includes(workerId)) throw new Error('load-lobby-invalid-worker');
  const workerOnly = workerId !== 'main';
  if (env.LOBBY_WORKER_ONLY !== String(workerOnly) || env.PGPOOL_MAX !== (workerOnly ? '6' : '10')) throw new Error('load-lobby-invalid-worker');
  const listenPort = port(env.PORT), databasePort = port(env.PGPORT);
  const redis = /^redis:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(redisUrl ?? '');
  if (!redis || !redisUrl) throw new Error('load-lobby-owned-redis-required');
  const redisPort = port(redis[1]);
  const publicOrigin = loopbackEndpoint(env.PUBLIC_ORIGIN);
  port(new URL(publicOrigin).port);
  if (new Set([listenPort, databasePort, redisPort]).size !== 3) throw new Error('load-lobby-invalid-port');
  return { runId, workerId, workerOnly, listenPort, databasePort, password, redisUrl, publicOrigin,
    publicAddress: `${new URL(publicOrigin).host}/workers/${workerId}`, maxAuthWork: workerOnly ? 4 : 8, poolSize: workerOnly ? 6 : 10 };
}

export type LoadLobbyConfig = ReturnType<typeof parseLoadLobbyConfig>;

/** Allow only the test database and disabled provider configuration to reach the account singleton. */
export function isolatedLoadLobbyEnvironment(config: LoadLobbyConfig, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test', AUTH_DB_PATH: loadLobbySchema, PGHOST: '127.0.0.1',
    PGDATABASE: loadLobbyDatabase, PGUSER: 'postgres', PGPORT: String(config.databasePort), PGPASSWORD: config.password,
    PGSSLMODE: 'disable', PGPOOL_MAX: String(config.poolSize), PGCONNECT_TIMEOUT_MS: '3000', PGSTATEMENT_TIMEOUT_MS: '5000',
    PGLOCK_TIMEOUT_MS: '3000', PUBLIC_ORIGIN: config.publicOrigin, NOWPAYMENTS_ENABLED: 'false', CASINOAPIPRO_ENABLED: 'false',
    CODEX_SALE_API_KEY: '' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  return environment;
}
