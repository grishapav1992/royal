import pg, { type PoolConfig } from 'pg';

const pollMs = 10;
const waitSample = `
  WITH watched AS (
    SELECT pid, hashtextextended(label, 0) AS lock_key
    FROM unnest($1::integer[], $2::text[]) AS target(pid, label)
  )
  SELECT l.pid, (EXTRACT(EPOCH FROM (statement_timestamp() - l.waitstart)) * 1000)::float8 AS wait_ms
  FROM watched w
  JOIN pg_locks l ON l.pid = w.pid AND l.locktype = 'advisory' AND NOT l.granted
    AND l.mode = 'ExclusiveLock' AND l.objsubid = 1
    AND l.classid::bigint = ((w.lock_key >> 32) & 4294967295::bigint)
    AND l.objid::bigint = (w.lock_key & 4294967295::bigint)
  JOIN pg_stat_activity a ON a.pid = l.pid AND a.datid = l.database
  WHERE a.datname = current_database() AND a.state = 'active'
    AND a.wait_event_type = 'Lock' AND a.wait_event = 'advisory'
    AND a.query_start <= l.waitstart AND l.waitstart < statement_timestamp()`;

type Watch = { key: string; observe: (waitMs: number) => void };

/** Uses a separate connection to sample a wait only while a fixture command is awaiting its lock. */
export async function startAuditLoadLockObserver(config: PoolConfig) {
  if (config.host !== '127.0.0.1' || config.database !== 'royal_test' || config.user !== 'postgres' ||
      !Number.isInteger(config.port) || config.port! < 1 || config.port! > 65535 ||
      typeof config.password !== 'string' || !/^[a-f0-9]{64}$/.test(config.password) || config.connectionString || config.stream) {
    throw new Error('Expected credentials for the disposable advisory lock observer');
  }
  const client = new pg.Client({ host: config.host, database: config.database, user: config.user, port: config.port,
    password: config.password, ssl: false, options: '-c search_path=pg_catalog', application_name: 'royal/audit-load-lock-observer',
    connectionTimeoutMillis: 2000, statement_timeout: 1000, query_timeout: 1200 });
  const pending = new Map<number, Watch>();
  let failed = false, closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  function clearPoll() {
    clearTimeout(timer);
    timer = undefined;
  }

  function fail() {
    if (closed) return;
    failed = true;
    clearPoll();
    pending.clear();
  }

  client.on('error', fail);
  try {
    await client.connect();
  } catch {
    await client.end().catch(() => {});
    throw new Error('Could not connect the isolated advisory lock observer');
  }

  async function sample(watches: Map<number, Watch>) {
    const { rows } = await client.query<{ pid: number; wait_ms: number }>(waitSample,
      [[...watches.keys()], [...watches.values()].map(watch => watch.key)]);
    for (const row of rows) {
      const watch = watches.get(row.pid);
      // A backend can be reused for another query while the sample is on its way back.
      if (watch && pending.get(row.pid) === watch && Number.isFinite(row.wait_ms) && row.wait_ms > 0) {
        watch.observe(row.wait_ms);
      }
    }
  }

  function schedule() {
    if (closed || failed || timer || running || !pending.size) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!pending.size) return;
      running = sample(new Map(pending)).catch(fail).finally(() => {
        running = undefined;
        schedule();
      });
    }, pollMs);
    timer.unref();
  }

  return {
    get failed() { return failed; },
    track(pid: number, key: string, observe: (waitMs: number) => void) {
      if (closed || failed) return () => {};
      const watch = { key, observe };
      pending.set(pid, watch);
      schedule();
      return () => {
        if (pending.get(pid) !== watch) return;
        pending.delete(pid);
        if (!pending.size) clearPoll();
      };
    },
    close() {
      return closing ??= (async () => {
        closed = true;
        clearPoll();
        pending.clear();
        await client.end().catch(() => { failed = true; });
        await running;
      })();
    },
  };
}
