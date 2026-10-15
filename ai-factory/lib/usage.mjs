export const USAGE_FIELDS = Object.freeze([
  'input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens',
]);

// Cache and reasoning counters are subsets of input and output respectively.
export function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !USAGE_FIELDS.includes(key))) throw new TypeError('Invalid token usage');
  const result = {};
  for (const key of USAGE_FIELDS.slice(0, 4)) {
    const count = Object.hasOwn(value, key) ? value[key] ?? null : null;
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) throw new TypeError('Invalid token usage counter');
    result[key] = count;
  }
  if (!Object.values(result).some(count => count !== null)) throw new TypeError('Token usage has no reported counters');
  if (result.cached_input_tokens !== null && result.input_tokens !== null && result.cached_input_tokens > result.input_tokens) throw new TypeError('Cached usage exceeds input usage');
  if (result.reasoning_output_tokens !== null && result.output_tokens !== null && result.reasoning_output_tokens > result.output_tokens) throw new TypeError('Reasoning usage exceeds output usage');
  result.total_tokens = result.input_tokens !== null && result.output_tokens !== null
    ? result.input_tokens + result.output_tokens : null;
  if (result.total_tokens !== null && !Number.isSafeInteger(result.total_tokens)) throw new TypeError('Token usage total is too large');
  if (value.total_tokens !== undefined && value.total_tokens !== null
    && (!Number.isSafeInteger(value.total_tokens) || value.total_tokens !== result.total_tokens)) throw new TypeError('Invalid token usage total');
  return result;
}

export const normalizeRunUsage = normalizeUsage;

export function usageTotals(row) {
  return Object.fromEntries(USAGE_FIELDS.map(key => {
    const value = row?.[key];
    if (value === null || value === undefined) return [key, null];
    // PostgreSQL aggregates numeric values exactly. Never publish a rounded total.
    const number = Number(value);
    return [key, Number.isSafeInteger(number) && number >= 0 ? number : null];
  }));
}

// This query returns bounded aggregate rows without loading task contents or events.
// Historical reports use the same safe counter rules as new executions.
export function usageSummarySql(table) {
  const normalizedCounter = key => `CASE WHEN jsonb_typeof(usage -> '${key}') = 'number'
    THEN CASE WHEN (usage ->> '${key}')::numeric BETWEEN 0 AND 9007199254740991
      AND trunc((usage ->> '${key}')::numeric) = (usage ->> '${key}')::numeric
      THEN (usage ->> '${key}')::numeric END END`;
  const counters = USAGE_FIELDS.slice(0, 4);
  return `WITH sources AS (
    SELECT role, usage, started_at AS reported_at, false AS legacy FROM ${table}.runs
      WHERE usage IS NOT NULL AND ($1::uuid IS NULL OR task_id = $1)
    UNION ALL
    SELECT details ->> 'role', details -> 'usage', created_at, true FROM ${table}.events e
      WHERE type = 'agent_usage' AND ($1::uuid IS NULL OR task_id = $1)
      AND NOT EXISTS (SELECT 1 FROM ${table}.runs r
        WHERE r.usage IS NOT NULL AND r.id::text = e.details ->> 'run_id')
  ), decoded AS (
    SELECT role, usage, reported_at, legacy, ${counters.map(key => `${normalizedCounter(key)} AS ${key}`).join(', ')}
      FROM sources
  ), valid AS (
    SELECT role, reported_at, legacy, ${counters.join(', ')}, input_tokens + output_tokens AS total_tokens
      FROM decoded WHERE jsonb_typeof(usage) = 'object'
      AND role IN ('analyst', 'developer', 'tester', 'release')
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(usage) = 'object' THEN usage ELSE '{}'::jsonb END) k
        WHERE k NOT IN ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'))
      AND ${counters.map(key => `(NOT usage ? '${key}' OR jsonb_typeof(usage -> '${key}') = 'null' OR ${key} IS NOT NULL)`).join(' AND ')}
      AND (${counters.map(key => `${key} IS NOT NULL`).join(' OR ')})
      AND (cached_input_tokens IS NULL OR input_tokens IS NULL OR cached_input_tokens <= input_tokens)
      AND (reasoning_output_tokens IS NULL OR output_tokens IS NULL OR reasoning_output_tokens <= output_tokens)
      AND (input_tokens IS NULL OR output_tokens IS NULL OR input_tokens + output_tokens <= 9007199254740991)
      AND (NOT usage ? 'total_tokens' OR jsonb_typeof(usage -> 'total_tokens') = 'null'
        OR CASE WHEN jsonb_typeof(usage -> 'total_tokens') = 'number'
          THEN (usage ->> 'total_tokens')::numeric = input_tokens + output_tokens ELSE false END)
  ), run_counts AS (
    SELECT role, count(*) AS total_runs FROM ${table}.runs WHERE ($1::uuid IS NULL OR task_id = $1) GROUP BY role
  ), summary AS (
    SELECT role, ${USAGE_FIELDS.map(key => `sum(${key}) AS ${key}`).join(', ')},
      count(*) FILTER (WHERE NOT legacy) AS reported_runs,
      count(*) FILTER (WHERE legacy) AS legacy_reports, min(reported_at) AS coverage_started_at
      FROM valid GROUP BY GROUPING SETS ((role), ())
  )
  SELECT s.*, COALESCE(c.total_runs, 0) AS total_runs FROM summary s
    LEFT JOIN run_counts c ON c.role = s.role WHERE s.role IS NOT NULL
  UNION ALL
  SELECT s.*, (SELECT COALESCE(sum(total_runs), 0) FROM run_counts) AS total_runs FROM summary s WHERE s.role IS NULL
  UNION ALL
  SELECT c.role, ${USAGE_FIELDS.map(() => 'NULL::numeric').join(', ')}, 0::bigint, 0::bigint, NULL::timestamptz, c.total_runs
    FROM run_counts c WHERE NOT EXISTS (SELECT 1 FROM summary s WHERE s.role = c.role)
  ORDER BY role NULLS FIRST`;
}
