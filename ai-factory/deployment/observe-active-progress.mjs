import { Store } from '../lib/store.mjs';
import { initialProgress } from '../lib/progress.mjs';
import { ROLE_TIMEOUT_MS } from '../lib/roles.mjs';
import { readSessionProgress } from '../lib/session-progress.mjs';
import pg from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const [taskId, runId, threadId, ...extra] = process.argv.slice(2);
const safeResult = { status: 'not_started', tool_calls: 0, tool_completed: 0 };
const sameProgress = (left, right, role) => Object.keys(initialProgress(role)).every(key => left?.[key] === right?.[key]);
let store;
let hardStop;
try {
  if (extra.length || ![taskId, runId, threadId].every(value => UUID.test(value || ''))) throw new TypeError('Invalid observer identifiers');
  // The original trusted configuration reads the secret internally. It never leaves this process.
  const { config } = await import('/app/lib/config.mjs');
  store = new Store({ pool: new pg.Pool({ connectionString: config().databaseUrl, max: 2,
    connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000,
    application_name: 'royal-progress-observer' }) });
  const began = Date.now();
  hardStop = setTimeout(() => {
    safeResult.status = 'observation_deadline'; console.log(JSON.stringify(safeResult)); process.exit(0);
  }, 45 * 60000); hardStop.unref();
  let previous = null, first = true;
  while (true) {
    const row = (await store.pool.query(`SELECT r.id, r.task_id, r.job_id, r.role, r.status AS run_status,
      r.started_at, r.requirements_version, r.execution, r.progress, r.lease_token,
      j.status AS job_status, j.lease_token AS job_token, j.requirements_version AS job_version,
      j.lease_expires_at > clock_timestamp() AS lease_valid,
      t.status AS task_status, t.requirements_version AS task_version
      FROM ${store.table}.runs r JOIN ${store.table}.jobs j ON j.id = r.job_id
      JOIN ${store.table}.tasks t ON t.id = r.task_id WHERE r.id = $1 AND r.task_id = $2`, [runId, taskId])).rows[0];
    const validStatus = { analyst: 'analyzing', developer: 'developing', tester: 'testing' }[row?.role];
    if (!row || !validStatus || row.run_status !== 'running' || row.job_status !== 'running'
      || !row.lease_valid || row.lease_token !== row.job_token || row.requirements_version !== row.job_version
      || row.requirements_version !== row.task_version || ![validStatus, ...(row.role === 'developer' ? ['repairing'] : [])].includes(row.task_status)) {
      safeResult.status = 'execution_ended'; break;
    }
    if ((first && Object.keys(row.progress ?? {}).length) || (!first && !sameProgress(row.progress, previous, row.role))) {
      safeResult.status = 'observation_already_changed'; break;
    }
    const timeout = ROLE_TIMEOUT_MS[row.role];
    const start = new Date(row.started_at).toISOString();
    const observed = await readSessionProgress({ codexHome: '/home/node/.codex', threadId,
      workspace: `/workspaces/${taskId}`, startedAt: start, role: row.role,
      model: row.execution?.requested_model, effort: row.execution?.requested_effort });
    const deadline = Math.min(began + 45 * 60000, Date.parse(observed.model_started_at) + timeout + 30000);
    if (Date.now() >= deadline) { safeResult.status = 'observation_deadline'; break; }
    const patch = { ...initialProgress(row.role), phase: 'model', phase_started_at: observed.model_started_at,
      ...observed, updated_at: new Date().toISOString() };
    await store.recordRunProgress(row.job_id, row.lease_token, patch, { expectedProgress: row.progress });
    previous = patch; first = false;
    safeResult.tool_calls = observed.tool_calls; safeResult.tool_completed = observed.tool_completed;
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, deadline - Date.now()))));
  }
} catch (error) {
  safeResult.status = ['stale_lease', 'stale_progress'].includes(error?.code) ? 'execution_changed' : 'observation_unavailable';
} finally {
  clearTimeout(hardStop);
  await store?.pool.end().catch(() => {});
  console.log(JSON.stringify(safeResult));
}
