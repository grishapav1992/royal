import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { BUG_SEVERITIES, DEFAULT_ROLE_PROFILES, ROLE_CATALOG, validateRoleProfiles } from './roles.mjs';
import { ACTIVITY_KINDS, PROGRESS_PHASES, initialProgress } from './progress.mjs';
import { refreshKnowledgeGraph, exchangeKnowledgeGraph } from './graph-store.mjs';
import { normalizeUsage, usageSummarySql, usageTotals } from './usage.mjs';

export const TASK_STATUSES = Object.freeze([
  'inbox', 'analyzing', 'needs_answers', 'ready', 'developing', 'testing',
  'repairing', 'ready_release', 'releasing', 'done', 'needs_attention', 'paused', 'cancelled',
]);
export const ROLES = Object.freeze(['analyst', 'developer', 'tester', 'release']);
export const BOARD_COLUMNS = Object.freeze({
  attention: ['needs_attention', 'paused', 'cancelled'],
  inbox: ['inbox'], analysis: ['analyzing', 'needs_answers'], ready: ['ready'],
  working: ['developing', 'repairing'], testing: ['testing'],
  release: ['ready_release', 'releasing'], done: ['done'],
});
const BOARD_ACTIONS = Object.freeze({ inbox: { analysis: 'analyze' }, ready: { working: 'start' } });
const RELEASE_DISABLED_REASON = 'Исполнитель публикации еще не настроен и не проверен. Выпуск пока недоступен.';

export function boardColumn(status) {
  return Object.keys(BOARD_COLUMNS).find(column => BOARD_COLUMNS[column].includes(status));
}
const DEFAULT_SETTINGS = Object.freeze({
  paused: false,
  auto_develop: false,
  auto_release: false,
  max_repairs: 3,
  max_job_attempts: 3,
  role_profiles: DEFAULT_ROLE_PROFILES,
});
const ROLE_STATUS = { analyst: 'analyzing', developer: 'developing', tester: 'testing', release: 'releasing' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function retryRole(run) {
  return run?.role === 'tester' && run.result?.passed === false && run.result?.bugs?.length ? 'developer' : run?.role ?? 'analyst';
}

function recoveryPlan(task, executorRole) {
  if (task.status === 'needs_attention') {
    const status = { analyst: 'inbox', developer: 'ready', tester: 'testing', release: 'ready_release' }[executorRole];
    return { action: 'retry', status, role: executorRole, column: boardColumn(ROLE_STATUS[executorRole]), repairCount: executorRole === 'tester' ? task.repair_count : 0 };
  }
  if (task.status === 'paused') {
    const previous = task.resume_status ?? 'inbox';
    const resume = { analyzing: ['inbox', 'analyst'], developing: ['ready', 'developer'], repairing: ['repairing', 'developer'], testing: ['testing', 'tester'], releasing: ['ready_release', null] }[previous] ?? [previous, null];
    return { action: 'resume', status: resume[0], role: resume[1], column: boardColumn(resume[1] ? ROLE_STATUS[resume[1]] : resume[0]), repairing: previous === 'repairing' };
  }
  return null;
}

export class StoreError extends Error {
  constructor(status, message, code = 'invalid_request') {
    super(message);
    this.name = 'StoreError';
    this.status = status;
    this.code = code;
  }
}

function object(value, name = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoreError(400, `${name} must be an object`);
  }
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw new StoreError(400, `${name} must be JSON`); }
  if (Buffer.byteLength(encoded) > 1_000_000) throw new StoreError(400, `${name} is too large`);
  return value;
}

function string(value, name, maximum = 100_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new StoreError(400, `${name} must be nonempty text, at most ${maximum} characters`);
  }
  return value.trim();
}

function id(value, name = 'id') {
  if (typeof value !== 'string' || !UUID.test(value)) throw new StoreError(400, `${name} must be a UUID`);
  return value;
}

function milliseconds(value, name = 'leaseMs', allowZero = false) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 86_400_000) {
    throw new StoreError(400, `${name} must be an integer between ${allowZero ? 0 : 1} and 86400000`);
  }
  return value;
}

function priority(value) {
  if (!['P0', 'P1', 'P2', 'P3'].includes(value)) throw new StoreError(400, 'priority must be P0, P1, P2 or P3');
  return value;
}

function role(value) {
  if (!ROLES.includes(value)) throw new StoreError(400, 'Unknown executor role');
  return value;
}

function candidateIdentity(artifact) {
  return artifact?.commit_sha ?? artifact?.commit ?? artifact?.candidate_id ?? null;
}

function validateEvidence(development, evidence) {
  const candidate = candidateIdentity(development);
  if (!candidate || candidateIdentity(evidence) !== candidate) {
    throw new StoreError(409, 'The report must identify the exact development candidate', 'candidate_mismatch');
  }
  if (development.image_digest && evidence.image_digest !== development.image_digest) {
    throw new StoreError(409, 'The report must identify the exact tested Docker image', 'candidate_mismatch');
  }
}

function publicJob(job) {
  const { lease_token, ...rest } = job;
  return rest;
}

function immutableContextMetadata(value, name, previous) {
  object(value, name);
  const keys = name === 'project_knowledge'
    ? ['version', 'sha256', 'updated_at', 'document_count', 'missing_documents']
    : name === 'knowledge_graph' ? ['sha256', 'node_count', 'edge_count', 'conflict_count'] : ['sha256', 'answer_count', 'delivery_count'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw new StoreError(400, `Unknown or missing ${name} metadata`);
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new StoreError(400, `Invalid ${name} hash`);
  if (name === 'project_knowledge') {
    if (typeof value.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.version)) throw new StoreError(400, 'Invalid project knowledge version');
    if (typeof value.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updated_at)
      || !Number.isFinite(Date.parse(value.updated_at)) || new Date(value.updated_at).toISOString() !== value.updated_at) throw new StoreError(400, 'Invalid project knowledge timestamp');
    if (!Number.isInteger(value.document_count) || value.document_count < 0 || value.document_count > 32) throw new StoreError(400, 'Invalid project knowledge document count');
    if (!Array.isArray(value.missing_documents) || value.missing_documents.length > 32
      || value.missing_documents.some(path => typeof path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,251}\.md$/.test(path)
        || path.split('/').some(part => !part || part === '.' || part === '..'))
      || new Set(value.missing_documents).size !== value.missing_documents.length) throw new StoreError(400, 'Invalid project knowledge missing documents');
  } else if (name === 'knowledge_graph') {
    if (![value.node_count,value.edge_count,value.conflict_count].every(count => Number.isInteger(count) && count >= 0 && count <= 20000)) throw new StoreError(400, 'Invalid knowledge graph counts');
  } else if (![value.answer_count, value.delivery_count].every(count => Number.isInteger(count) && count >= 0 && count <= 100)) {
    throw new StoreError(400, 'Invalid task memory counts');
  }
  const result = Object.fromEntries(keys.map(key => [key, value[key]]));
  if (previous !== undefined && !isDeepStrictEqual(previous, result)) {
    throw new StoreError(409, `The ${name} snapshot is immutable within an execution`, 'context_mismatch');
  }
  return result;
}

export function memoryText(value, maximumBytes) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/\u2014/g, '-')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:access_token|refresh_token|api_key|password|secret|token|key)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/((?:[A-Za-z0-9_-]*(?:token|api[_-]?key|password|secret|private[_-]?key|mnemonic|seed[_-]?phrase|cookie|authorization)|пароль|секрет|ключ)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, '$1[redacted]');
  let low = 0; let high = clean.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(clean.slice(0, middle))) <= maximumBytes) low = middle;
    else high = middle - 1;
  }
  if (low && /[\uD800-\uDBFF]/.test(clean[low - 1])) low -= 1;
  return clean.slice(0, low);
}

function executionPatch(value, role, execution) {
  object(value, 'execution patch');
  const allowed = ['actual_model', 'actual_effort', 'skills', 'thread_id', 'observation_status', 'project_knowledge', 'task_memory', 'knowledge_graph'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new StoreError(400, 'Unknown or immutable execution field');
  const result = {};
  for (const name of ['project_knowledge', 'task_memory', 'knowledge_graph']) {
    if (Object.hasOwn(value, name)) result[name] = immutableContextMetadata(value[name], name, execution[name]);
  }
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  for (const key of ['actual_model', 'thread_id']) {
    if (!Object.hasOwn(value, key)) continue;
    if (value[key] !== null && (typeof value[key] !== 'string' || !identifier.test(value[key]))) throw new StoreError(400, `Invalid ${key}`);
    result[key] = value[key];
  }
  if (Object.hasOwn(value, 'actual_effort')) {
    if (value.actual_effort !== null && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value.actual_effort)) throw new StoreError(400, 'Invalid actual_effort');
    result.actual_effort = value.actual_effort;
  }
  if (Object.hasOwn(value, 'observation_status')) {
    if (!['pending', 'observed', 'unavailable', 'failed'].includes(value.observation_status)) throw new StoreError(400, 'Invalid observation_status');
    result.observation_status = value.observation_status;
  }
  if (Object.hasOwn(value, 'skills')) {
    const allowedSkills = ROLE_CATALOG.roles.find(({ id }) => id === role)?.skills ?? [];
    const requested = execution.requested_skills ?? [];
    if (!Array.isArray(value.skills) || value.skills.length > allowedSkills.length) throw new StoreError(400, 'Invalid execution skills');
    result.skills = Array.from(value.skills, (skill) => {
      object(skill, 'execution skill');
      if (Object.keys(skill).length !== 3 || Object.keys(skill).some((key) => !['id', 'sha256', 'version'].includes(key))
        || !allowedSkills.includes(skill.id) || !requested.includes(skill.id)
        || typeof skill.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(skill.sha256)
        || typeof skill.version !== 'string' || !identifier.test(skill.version)) throw new StoreError(400, 'Invalid execution skill metadata');
      return { id: skill.id, sha256: skill.sha256, version: skill.version };
    });
    if (new Set(result.skills.map(({ id }) => id)).size !== result.skills.length) throw new StoreError(400, 'Duplicate execution skills');
  }
  return result;
}

function progressPatch(value, executorRole, previous) {
  object(value, 'progress patch');
  const keys = Object.keys(initialProgress(executorRole));
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new StoreError(400, 'Unknown or missing progress field');
  if (!PROGRESS_PHASES.includes(value.phase) || (value.activity_kind !== null && !ACTIVITY_KINDS.includes(value.activity_kind))) throw new StoreError(400, 'Invalid progress phase or activity');
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  for (const key of ['phase_started_at', 'updated_at']) if (!timestamp(value[key])) throw new StoreError(400, `Invalid progress ${key}`);
  for (const key of ['last_activity_at', 'model_started_at']) if (value[key] !== null && !timestamp(value[key])) throw new StoreError(400, `Invalid progress ${key}`);
  if (![value.tool_calls, value.tool_completed].every(count => Number.isSafeInteger(count) && count >= 0) || value.tool_completed > value.tool_calls) throw new StoreError(400, 'Invalid progress tool counters');
  if (value.timeout_ms !== initialProgress(executorRole).timeout_ms) throw new StoreError(400, 'Immutable role timeout');
  if ((value.phase === 'model' && value.model_started_at === null) || (value.model_started_at === null && (value.last_activity_at !== null || value.tool_calls > 0 || value.tool_completed > 0))
    || ((value.activity_kind === null) !== (value.last_activity_at === null))) throw new StoreError(400, 'Invalid model activity state');
  for (const key of ['phase_started_at', 'model_started_at', 'last_activity_at']) if (value[key] !== null && Date.parse(value[key]) > Date.parse(value.updated_at)) throw new StoreError(400, 'Invalid progress time order');
  if (previous.updated_at && Date.parse(value.updated_at) < Date.parse(previous.updated_at)) throw new StoreError(409, 'Progress cannot move backwards', 'stale_progress');
  if (previous.model_started_at && value.model_started_at !== previous.model_started_at) throw new StoreError(409, 'Model start time is immutable', 'stale_progress');
  if ((previous.tool_calls ?? 0) > value.tool_calls || (previous.tool_completed ?? 0) > value.tool_completed
    || (previous.last_activity_at && (!value.last_activity_at || Date.parse(value.last_activity_at) < Date.parse(previous.last_activity_at)))) throw new StoreError(409, 'Progress cannot move backwards', 'stale_progress');
  const transitions = { preparing: ['preparing', 'build', 'model', 'saving'], build: ['build', 'server_tests', 'saving'], server_tests: ['server_tests', 'browser_tests', 'model', 'saving'], browser_tests: ['browser_tests', 'model', 'saving'], model: ['model', 'saving'], saving: ['saving'] };
  if (previous.phase && !transitions[previous.phase]?.includes(value.phase)) throw new StoreError(409, 'Progress phase cannot move backwards', 'stale_progress');
  if (previous.phase === value.phase && previous.phase_started_at !== value.phase_started_at) throw new StoreError(409, 'Phase start time is immutable', 'stale_progress');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

export class Store {
  constructor(options = {}) {
    if (typeof options === 'string') options = { connectionString: options };
    const { connectionString, pool, schema = 'ai_factory' } = options;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new StoreError(400, 'Invalid PostgreSQL schema name');
    this.schema = schema;
    this.table = `"${schema}"`;
    this.pool = pool ?? new pg.Pool({ connectionString });
    this.ownsPool = !pool;
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof StoreError) throw error;
      if (error.code === '23505') throw new StoreError(409, 'This operation conflicts with existing work', 'conflict');
      if (error.code === '23503') throw new StoreError(409, 'A referenced record does not exist', 'missing_reference');
      throw error;
    } finally {
      client.release();
    }
  }

  async init(seedTasks = []) {
    const source = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${this.schema}:initialize`]);
      await client.query(source.replaceAll(/\bai_factory\b/g, this.table));
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await client.query(`INSERT INTO ${this.table}.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [key, JSON.stringify(value)]);
      }
    });
    if (seedTasks.length) await this.seedTasks(seedTasks);
    return this;
  }

  async seedTasks(tasks) {
    if (!Array.isArray(tasks)) throw new StoreError(400, 'Seed tasks must be an array');
    if (!tasks.length) return { seeded: false, count: 0 };
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${this.schema}:seed`]);
      const previous = await client.query(`SELECT value FROM ${this.table}.settings WHERE key = '_seed_completed'`);
      if (previous.rowCount) return { seeded: false, count: 0 };
      for (const task of tasks) await this._createTask(client, task);
      await client.query(`INSERT INTO ${this.table}.settings (key, value) VALUES ('_seed_completed', $1::jsonb)`, [JSON.stringify({ count: tasks.length })]);
      return { seeded: true, count: tasks.length };
    });
  }

  async _event(client, taskId, type, details = {}, actor = 'system') {
    return (await client.query(`INSERT INTO ${this.table}.events (task_id, type, actor, details) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`, [taskId, type, actor, JSON.stringify(details)])).rows[0];
  }

  async recordEvent(taskId, type, details = {}, actor = 'system') {
    if (taskId !== null) id(taskId);
    string(type, 'event type', 100);
    string(actor, 'actor', 100);
    object(details, 'event details');
    return this.transaction((client) => this._event(client, taskId, type, details, actor));
  }

  async _task(client, taskId, lock = false) {
    const lockClause = lock === 'no-key-update' ? 'FOR NO KEY UPDATE' : lock ? 'FOR UPDATE' : '';
    const row = (await client.query(`SELECT * FROM ${this.table}.tasks WHERE id = $1 ${lockClause}`, [taskId])).rows[0];
    if (!row) throw new StoreError(404, 'Task not found', 'not_found');
    return row;
  }

  async _detail(client, taskId) {
    const task = await this._task(client, taskId);
    const queries = [
      ['questions', `SELECT * FROM ${this.table}.questions WHERE task_id = $1 ORDER BY created_at, id`],
      ['runs', `SELECT id, job_id, task_id, role, attempt, requirements_version, worker_id, status, result, execution, progress, usage, error, started_at, finished_at FROM ${this.table}.runs WHERE task_id = $1 ORDER BY started_at, id`],
      ['events', `SELECT * FROM ${this.table}.events WHERE task_id = $1 ORDER BY id`],
      ['bugs', `SELECT * FROM ${this.table}.bugs WHERE task_id = $1 ORDER BY created_at, id`],
      ['jobs', `SELECT id, task_id, role, status, requirements_version, worker_id, lease_expires_at, attempts, max_attempts, available_at, started_at, finished_at, last_error, created_at, updated_at FROM ${this.table}.jobs WHERE task_id = $1 ORDER BY created_at, id`],
    ];
    for (const [key, sql] of queries) task[key] = (await client.query(sql, [taskId])).rows;
    task.active_run = (await client.query(`SELECT ${this._activeRunSql('t')} AS active_run FROM ${this.table}.tasks t WHERE t.id = $1`, [taskId])).rows[0].active_run;
    task.board_release_enabled = (await client.query(`SELECT value -> 'release_enabled' AS enabled FROM ${this.table}.settings WHERE key = '_runtime'`)).rows[0]?.enabled;
    return this._boardTask(task, task.jobs.some(job => ['pending', 'running'].includes(job.status)));
  }

  _boardTask(task, activeJob = task.board_active_job) {
    const { board_active_job, board_latest_run, board_latest_job, board_release_enabled, ...visible } = task;
    const column = boardColumn(task.status);
    const latestRun = board_latest_run ?? task.runs?.at(-1);
    const latestJob = board_latest_job ?? task.jobs?.at(-1);
    const plan = recoveryPlan(task, latestRun?.retry_role ?? retryRole(latestRun));
    const releaseBlocked = plan?.role === 'release' && board_release_enabled === false;
    const actions = activeJob ? {} : { ...(BOARD_ACTIONS[task.status] || {}),
      ...(plan && plan.column !== column && !releaseBlocked ? { [plan.column]: plan.action } : {}) };
    const failure = task.status === 'needs_attention' ? { role: latestRun?.role ?? latestJob?.role ?? null, error: latestRun?.error || latestJob?.last_error || null } : null;
    return { ...visible, board_moves: [column, ...Object.keys(actions)], board_move_actions: actions,
      board_blocked_reason: releaseBlocked ? RELEASE_DISABLED_REASON : null,
      board_last_failure: failure && (failure.role || failure.error) ? failure : null };
  }

  _activeRunSql(taskAlias) {
    return `(SELECT jsonb_build_object('id', r.id, 'role', r.role, 'status', r.status, 'started_at', r.started_at,
      'progress', r.progress, 'usage', r.usage, 'lease_expires_at', j.lease_expires_at)
      FROM ${this.table}.runs r JOIN ${this.table}.jobs j ON j.id = r.job_id
      WHERE r.task_id = ${taskAlias}.id AND r.status = 'running' AND j.status = 'running'
      AND r.lease_token = j.lease_token AND r.requirements_version = ${taskAlias}.requirements_version
      AND j.requirements_version = ${taskAlias}.requirements_version AND ${taskAlias}.status NOT IN ('paused', 'cancelled', 'done')
      ORDER BY r.started_at DESC LIMIT 1)`;
  }

  async getTask(taskId) {
    id(taskId);
    return this.transaction((client) => this._detail(client, taskId));
  }

  async projectMemory({ excludeTaskId, limit = 20, archive = false, queryClient } = {}) {
    if (excludeTaskId !== undefined) id(excludeTaskId, 'excludeTaskId');
    if (!Number.isInteger(limit) || limit < 0 || limit > (archive ? 10000 : 20)) throw new StoreError(400, 'Project memory limit is invalid');
    if (limit === 0) return { answers: [], deliveries: [] };
    const read = async client => {
      const answers = (await client.query(`SELECT q.task_id, t.title, q.text, q.answer, q.answered_at
        FROM ${this.table}.questions q JOIN ${this.table}.tasks t ON t.id = q.task_id
        WHERE q.status = 'answered' AND q.answered_at IS NOT NULL AND length(btrim(q.answer)) > 0
          AND t.status <> 'cancelled' AND ($1::uuid IS NULL OR q.task_id <> $1::uuid)
        ORDER BY q.answered_at DESC, q.id DESC LIMIT $2`, [excludeTaskId ?? null, limit])).rows;
      const deliveries = (await client.query(`SELECT t.id AS task_id, t.title, t.status, t.updated_at,
          t.spec ->> 'scope' AS scope, t.spec -> 'acceptance' AS acceptance,
          developer.result ->> 'summary' AS developer_summary, tester.result ->> 'summary' AS tester_summary,
          COALESCE(release.result ->> 'summary', tester.result ->> 'summary') AS summary,
          COALESCE(t.artifact #>> '{developer,commit_sha}', t.artifact #>> '{developer,commit}', t.artifact #>> '{developer,candidate_id}') AS candidate
        FROM ${this.table}.tasks t
        JOIN LATERAL (SELECT r.result FROM ${this.table}.runs r WHERE r.task_id = t.id AND r.role = 'developer'
          AND r.status = 'succeeded' AND r.requirements_version = t.requirements_version
          AND COALESCE(r.result #>> '{artifact,commit_sha}', r.result #>> '{artifact,commit}', r.result #>> '{artifact,candidate_id}') =
            COALESCE(t.artifact #>> '{developer,commit_sha}', t.artifact #>> '{developer,commit}', t.artifact #>> '{developer,candidate_id}')
          ORDER BY r.finished_at DESC, r.id DESC LIMIT 1) developer ON true
        JOIN LATERAL (SELECT r.result FROM ${this.table}.runs r WHERE r.task_id = t.id AND r.role = 'tester'
          AND r.status = 'succeeded' AND r.requirements_version = t.requirements_version AND r.result ->> 'passed' = 'true'
          AND r.id::text = t.artifact #>> '{tester,run_id}' LIMIT 1) tester ON true
        LEFT JOIN LATERAL (SELECT r.id, r.result FROM ${this.table}.runs r WHERE r.task_id = t.id AND r.role = 'release'
          AND r.status = 'succeeded' AND r.requirements_version = t.requirements_version
          AND COALESCE(r.result #>> '{artifact,commit_sha}', r.result #>> '{artifact,commit}', r.result #>> '{artifact,candidate_id}') =
            COALESCE(t.artifact #>> '{developer,commit_sha}', t.artifact #>> '{developer,commit}', t.artifact #>> '{developer,candidate_id}')
          ORDER BY r.finished_at DESC, r.id DESC LIMIT 1) release ON true
        WHERE t.status IN ('done', 'ready_release') AND t.artifact ->> 'requirements_version' = t.requirements_version::text
          AND t.artifact #>> '{tester,passed}' = 'true' AND (t.status = 'ready_release' OR release.id IS NOT NULL)
          AND ($1::uuid IS NULL OR t.id <> $1::uuid)
        ORDER BY t.updated_at DESC, t.id DESC LIMIT $2`, [excludeTaskId ?? null, archive ? limit : Math.min(limit, 10)])).rows;
      return {
        answers: answers.map(answer => ({
          task_id: answer.task_id, title: memoryText(answer.title, 300), text: memoryText(answer.text, 700),
          answer: memoryText(answer.answer, 2500), answered_at: new Date(answer.answered_at).toISOString(),
        })),
        deliveries: deliveries.map(delivery => ({
          task_id: delivery.task_id, title: memoryText(delivery.title, 300),
          state: delivery.status === 'done' ? 'released' : 'candidate_awaiting_release',
          summary: memoryText(delivery.summary, 600), scope: memoryText(delivery.scope, 450),
          acceptance: (Array.isArray(delivery.acceptance) ? delivery.acceptance : []).filter(value => typeof value === 'string').slice(0, 4).map(value => memoryText(value, 150)),
          developer_summary: memoryText(delivery.developer_summary, 450), tester_summary: memoryText(delivery.tester_summary, 450),
          updated_at: new Date(delivery.updated_at).toISOString(),
          ...(typeof delivery.candidate === 'string' && /^[a-f0-9]{7,64}$/.test(delivery.candidate) ? { commit_sha: delivery.candidate } : {}),
        })),
      };
    };
    return queryClient ? read(queryClient) : this.transaction(read);
  }

  async knowledgeGraph() { return refreshKnowledgeGraph(this, memoryText); }
  async exchangeKnowledgeGraph(events) { return exchangeKnowledgeGraph(this, events, memoryText); }

  async listTasks({ status, parent_id: parentId } = {}) {
    const clauses = [];
    const values = [];
    if (status !== undefined) {
      if (!TASK_STATUSES.includes(status)) throw new StoreError(400, 'Unknown task status');
      values.push(status);
      clauses.push(`t.status = $${values.length}`);
    }
    if (parentId !== undefined) {
      if (parentId === null) clauses.push('t.parent_id IS NULL');
      else { values.push(id(parentId)); clauses.push(`t.parent_id = $${values.length}`); }
    }
    const rows = (await this.pool.query(`SELECT t.*, ${this._activeRunSql('t')} AS active_run,
      EXISTS (SELECT 1 FROM ${this.table}.jobs j WHERE j.task_id = t.id AND j.status IN ('pending', 'running')) AS board_active_job,
      (SELECT jsonb_build_object('role', r.role, 'error', r.error, 'retry_role', CASE WHEN r.role = 'tester' AND r.result ->> 'passed' = 'false'
        AND jsonb_typeof(r.result -> 'bugs') = 'array' AND r.result -> 'bugs' <> '[]'::jsonb THEN 'developer' ELSE r.role END)
        FROM ${this.table}.runs r WHERE r.task_id = t.id ORDER BY r.started_at DESC, r.id DESC LIMIT 1) AS board_latest_run,
      (SELECT jsonb_build_object('role', j.role, 'last_error', j.last_error) FROM ${this.table}.jobs j
        WHERE j.task_id = t.id ORDER BY j.created_at DESC, j.id DESC LIMIT 1) AS board_latest_job,
      (SELECT value -> 'release_enabled' FROM ${this.table}.settings WHERE key = '_runtime') AS board_release_enabled,
      (SELECT count(*)::integer FROM ${this.table}.questions q WHERE q.task_id = t.id AND q.status = 'open') AS open_questions,
      (SELECT count(*)::integer FROM ${this.table}.bugs b WHERE b.task_id = t.id AND b.status = 'open') AS open_bugs
      FROM ${this.table}.tasks t ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY t.priority, t.created_at, t.id`, values)).rows;
    return rows.map(task => this._boardTask(task));
  }

  async moveTask(taskId, input, { requireRuntime = false } = {}) {
    id(taskId);
    object(input, 'board move');
    if (Object.keys(input).some(key => !['column_id', 'before_task_id', 'expected_status'].includes(key))) {
      throw new StoreError(400, 'Некорректные поля перемещения.');
    }
    const column = input.column_id;
    if (typeof column !== 'string' || !Object.hasOwn(BOARD_COLUMNS, column)) throw new StoreError(400, 'Неизвестная колонка доски.');
    if (!TASK_STATUSES.includes(input.expected_status)) throw new StoreError(400, 'Передай текущий статус задачи.');
    const beforeId = input.before_task_id == null ? null : id(input.before_task_id, 'before_task_id').toLowerCase();
    if (beforeId === taskId.toLowerCase()) throw new StoreError(400, 'Нельзя переместить задачу перед самой собой.');
    return this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${this.schema}:board-order`]);
      const task = await this._task(client, taskId, 'no-key-update');
      if (task.status !== input.expected_status) {
        throw new StoreError(409, 'Статус задачи уже изменился. Доска обновится, повтори перемещение.', 'stale_status');
      }
      const previousColumn = boardColumn(task.status);
      let action = null;
      if (column !== previousColumn) {
        const active = (await client.query(`SELECT id FROM ${this.table}.jobs WHERE task_id = $1 AND status IN ('pending', 'running') FOR UPDATE`, [task.id])).rowCount;
        if (active) throw new StoreError(409, 'Исполнитель уже работает над задачей. Можно менять ее порядок в текущей колонке.', 'active_job');
        const plan = await this._recoveryPlan(client, task);
        action = BOARD_ACTIONS[task.status]?.[column] ?? (plan?.column === column ? plan.action : null);
        if (!action) {
          const reason = task.status === 'needs_answers' ? 'Сначала ответь на вопросы в карточке задачи.'
            : ['needs_attention', 'paused', 'cancelled'].includes(task.status) ? 'Открой карточку и выбери повторный запуск или возобновление работы.'
            : 'Этот этап меняется после завершения работы исполнителя. Перемещение не может пропустить анализ, проверку или выпуск.';
          throw new StoreError(409, reason, 'invalid_transition');
        }
        if (action === 'retry' || action === 'resume') await this._recoverTask(client, task, action, plan, { requireRuntime });
        else {
          if (requireRuntime) await this._assertRuntime(client);
          await this._enqueue(client, task, action === 'analyze' ? 'analyst' : 'developer');
        }
        await this._event(client, task.id, 'task_action', { action, previous_status: task.status }, 'user');
      }
      const tasks = (await client.query(`SELECT * FROM ${this.table}.tasks WHERE status = ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE`, [BOARD_COLUMNS[column]])).rows;
      if (beforeId && !tasks.some(item => item.id === beforeId)) {
        throw new StoreError(409, 'Задача, перед которой выполнялось перемещение, уже ушла из этой колонки. Обнови доску.', 'stale_position');
      }
      const position = item => item.board_column === column && Number.isInteger(item.board_position) ? item.board_position : Infinity;
      const ordered = tasks.filter(item => item.id !== task.id).sort((a, b) => position(a) - position(b)
        || a.priority.localeCompare(b.priority) || a.created_at - b.created_at || a.id.localeCompare(b.id));
      ordered.splice(beforeId ? ordered.findIndex(item => item.id === beforeId) : ordered.length, 0, task);
      await client.query(`UPDATE ${this.table}.tasks t SET board_column = $1, board_position = ordered.position - 1
        FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, position) WHERE t.id = ordered.id`, [column, ordered.map(item => item.id)]);
      await this._event(client, task.id, 'task_moved', { column_id: column, previous_column_id: previousColumn, before_task_id: beforeId }, 'user');
      return this._detail(client, task.id);
    });
  }

  async _createTask(client, input) {
    object(input, 'task');
    const title = string(input.title, 'title', 300);
    const description = input.description ?? '';
    if (typeof description !== 'string' || description.length > 100_000) throw new StoreError(400, 'Invalid description');
    const taskId = input.id === undefined ? randomUUID() : id(input.id);
    const parentId = input.parent_id == null ? null : id(input.parent_id, 'parent_id');
    const row = (await client.query(`INSERT INTO ${this.table}.tasks (id, title, description, priority, parent_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [taskId, title, description, priority(input.priority ?? 'P2'), parentId])).rows[0];
    await this._event(client, taskId, 'task_created', { title }, 'user');
    return row;
  }

  async createTask(input) {
    return this.transaction((client) => this._createTask(client, input));
  }

  async _revoke(client, taskId, reason) {
    await client.query(`UPDATE ${this.table}.runs SET status = 'revoked', error = $2, finished_at = clock_timestamp() WHERE task_id = $1 AND status = 'running'`, [taskId, reason]);
    await client.query(`UPDATE ${this.table}.jobs SET status = 'revoked', lease_token = NULL, lease_expires_at = NULL, last_error = $2, finished_at = clock_timestamp(), updated_at = clock_timestamp() WHERE task_id = $1 AND status IN ('pending', 'running')`, [taskId, reason]);
  }

  async updateTask(taskId, patch) {
    id(taskId);
    object(patch, 'task patch');
    const allowed = ['title', 'description', 'priority', 'parent_id', 'spec'];
    if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new StoreError(400, 'Task state changes require an action');
    return this.transaction(async (client) => {
      const task = await this._task(client, taskId, true);
      const next = { ...task, ...patch };
      string(next.title, 'title', 300);
      if (typeof next.description !== 'string' || next.description.length > 100_000) throw new StoreError(400, 'Invalid description');
      priority(next.priority);
      if (next.parent_id !== null) id(next.parent_id, 'parent_id');
      if (next.parent_id === taskId) throw new StoreError(400, 'A task cannot be its own parent');
      object(next.spec, 'spec');
      const changed = ['title', 'description', 'parent_id', 'spec'].some((key) => JSON.stringify(next[key]) !== JSON.stringify(task[key]));
      if (changed) {
        await this._revoke(client, taskId, 'Requirements changed');
        await client.query(`UPDATE ${this.table}.questions SET status = 'cancelled' WHERE task_id = $1 AND status = 'open'`, [taskId]);
      }
      await client.query(`UPDATE ${this.table}.tasks SET title = $2, description = $3, priority = $4, parent_id = $5,
        spec = $6::jsonb, artifact = CASE WHEN $7 THEN '{}'::jsonb ELSE artifact END,
        requirements_version = requirements_version + CASE WHEN $7 THEN 1 ELSE 0 END,
        status = CASE WHEN $7 THEN 'inbox' ELSE status END,
        repair_count = CASE WHEN $7 THEN 0 ELSE repair_count END,
        resume_status = CASE WHEN $7 THEN NULL ELSE resume_status END, updated_at = clock_timestamp() WHERE id = $1`,
      [taskId, next.title.trim(), next.description, next.priority, next.parent_id, JSON.stringify(patch.spec ?? (changed ? {} : task.spec)), changed]);
      await this._event(client, taskId, 'task_updated', { fields: Object.keys(patch), requirements_changed: changed }, 'user');
      return this._detail(client, taskId);
    });
  }

  async _settings(client) {
    const rows = (await client.query(`SELECT key, value FROM ${this.table}.settings WHERE left(key, 1) <> '_'`)).rows;
    return { ...structuredClone(DEFAULT_SETTINGS), ...Object.fromEntries(rows.map(({ key, value }) => [key, value])) };
  }

  async getSettings() {
    return this._settings(this.pool);
  }

  async updateSettings(patch) {
    object(patch, 'settings');
    patch = { ...patch };
    for (const [key, value] of Object.entries(patch)) {
      string(key, 'setting key', 100);
      if (key.startsWith('_')) throw new StoreError(400, 'Internal settings cannot be changed');
      if (['auto_develop', 'auto_release'].includes(key) && typeof value !== 'boolean') throw new StoreError(400, `${key} must be boolean`);
      if (key === 'max_repairs' && (!Number.isInteger(value) || value < 1 || value > 3)) throw new StoreError(400, 'max_repairs must be between 1 and 3');
      if (key === 'max_job_attempts' && (!Number.isInteger(value) || value < 1 || value > 10)) throw new StoreError(400, 'max_job_attempts must be between 1 and 10');
      if (key === 'role_profiles') patch[key] = validateRoleProfiles(value);
    }
    return this.transaction(async (client) => {
      for (const [key, value] of Object.entries(patch)) {
        await client.query(`INSERT INTO ${this.table}.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = clock_timestamp()`, [key, JSON.stringify(value)]);
      }
      await this._event(client, null, 'settings_updated', { keys: Object.keys(patch) }, 'user');
      return this._settings(client);
    });
  }

  async setRuntime(patch) {
    object(patch, 'runtime');
    const { updated_at, stale, ...values } = patch;
    for (const key of ['authenticated', 'available']) {
      if (key in values && typeof values[key] !== 'boolean') throw new StoreError(400, `${key} must be boolean`);
    }
    const row = (await this.pool.query(`INSERT INTO ${this.table}.settings (key, value)
      VALUES ('_runtime', $1::jsonb || jsonb_build_object('updated_at', clock_timestamp()))
      ON CONFLICT (key) DO UPDATE SET value = ${this.table}.settings.value || $1::jsonb || jsonb_build_object('updated_at', clock_timestamp()), updated_at = clock_timestamp()
      RETURNING value`, [JSON.stringify(values)])).rows[0];
    return this._runtime(row.value);
  }

  _runtime(value = {}) {
    const defaults = { authenticated: false, available: false, worker_status: 'offline', mode: 'stopped', updated_at: null };
    const runtime = { ...defaults, ...value };
    const stale = !runtime.updated_at || Date.now() - Date.parse(runtime.updated_at) > 60_000 || !Number.isFinite(Date.parse(runtime.updated_at));
    return { ...runtime, ...(stale ? { authenticated: false, available: false, worker_status: 'offline' } : {}), stale };
  }

  async getRuntime() {
    const row = (await this.pool.query(`SELECT value FROM ${this.table}.settings WHERE key = '_runtime'`)).rows[0];
    return this._runtime(row?.value);
  }

  async _enqueue(client, task, executorRole, { repairing = false } = {}) {
    role(executorRole);
    const allowed = {
      analyst: ['inbox', 'ready', 'needs_answers', 'needs_attention', 'analyzing'],
      developer: ['ready', 'repairing', 'developing', 'needs_attention'],
      tester: ['developing', 'repairing', 'testing'],
      release: ['ready_release', 'releasing'],
    }[executorRole];
    if (!allowed.includes(task.status)) throw new StoreError(409, `Cannot run ${executorRole} from ${task.status}`, 'invalid_transition');
    const active = (await client.query(`SELECT * FROM ${this.table}.jobs WHERE task_id = $1 AND status IN ('pending', 'running') FOR UPDATE`, [task.id])).rows[0];
    if (active) {
      if (active.role === executorRole && active.requirements_version === task.requirements_version) return publicJob(active);
      throw new StoreError(409, 'The task already has an active executor', 'active_job');
    }
    const settings = await this._settings(client);
    const status = repairing && executorRole === 'developer' ? 'repairing' : ROLE_STATUS[executorRole];
    const job = (await client.query(`INSERT INTO ${this.table}.jobs (id, task_id, role, requirements_version, max_attempts) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [randomUUID(), task.id, executorRole, task.requirements_version, settings.max_job_attempts])).rows[0];
    await client.query(`UPDATE ${this.table}.tasks SET status = $2, resume_status = NULL, updated_at = clock_timestamp() WHERE id = $1`, [task.id, status]);
    await this._event(client, task.id, 'job_queued', { job_id: job.id, role: executorRole, requirements_version: task.requirements_version });
    return publicJob(job);
  }

  async enqueue(taskId, executorRole) {
    id(taskId);
    role(executorRole);
    return this.transaction(async (client) => this._enqueue(client, await this._task(client, taskId, true), executorRole));
  }

  async claimJob(workerId, leaseMs = 120_000) {
    string(workerId, 'workerId', 200);
    milliseconds(leaseMs);
    return this.transaction(async (client) => {
      const task = (await client.query(`SELECT t.* FROM ${this.table}.tasks t
        WHERE t.status NOT IN ('paused', 'cancelled', 'done') AND EXISTS (
          SELECT 1 FROM ${this.table}.jobs j WHERE j.task_id = t.id AND j.status = 'pending'
          AND j.available_at <= clock_timestamp() AND j.requirements_version = t.requirements_version
        ) ORDER BY t.priority, t.created_at, t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1`)).rows[0];
      if (!task) return null;
      const pending = (await client.query(`SELECT * FROM ${this.table}.jobs WHERE task_id = $1 AND status = 'pending' AND available_at <= clock_timestamp() FOR UPDATE LIMIT 1`, [task.id])).rows[0];
      if (!pending) return null;
      const token = randomUUID();
      const job = (await client.query(`UPDATE ${this.table}.jobs SET status = 'running', worker_id = $2, lease_token = $3,
        lease_expires_at = clock_timestamp() + $4 * interval '1 millisecond', attempts = attempts + 1,
        started_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 RETURNING *`, [pending.id, workerId, token, leaseMs])).rows[0];
      const runAttempt = (await client.query(`SELECT COALESCE(max(attempt), 0) + 1 AS next_attempt FROM ${this.table}.runs WHERE job_id = $1`, [job.id])).rows[0].next_attempt;
      const profiles = validateRoleProfiles((await this._settings(client)).role_profiles);
      const profile = profiles[job.role];
      const execution = profile ? {
        requested_model: profile.model, requested_effort: profile.reasoning_effort, requested_skills: profile.skills,
        actual_model: null, actual_effort: null, skills: [],
      } : {};
      const run = (await client.query(`INSERT INTO ${this.table}.runs (id, job_id, task_id, role, attempt, requirements_version, lease_token, worker_id, execution, progress)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb) RETURNING *`, [randomUUID(), job.id, task.id, job.role, runAttempt, job.requirements_version, token, workerId, JSON.stringify(execution), JSON.stringify(initialProgress(job.role))])).rows[0];
      await this._event(client, task.id, 'job_started', { job_id: job.id, run_id: run.id, role: job.role, attempt: runAttempt, failure_attempt: job.attempts, worker_id: workerId });
      const { lease_token, ...publicRun } = run;
      return { job: publicJob(job), task: await this._detail(client, task.id), run: publicRun, token, execution: run.execution };
    });
  }

  async heartbeat(jobId, token, leaseMs = 120_000) {
    id(jobId, 'jobId');
    id(token, 'token');
    milliseconds(leaseMs);
    const row = (await this.pool.query(`UPDATE ${this.table}.jobs j SET lease_expires_at = clock_timestamp() + $3 * interval '1 millisecond', updated_at = clock_timestamp()
      WHERE j.id = $1 AND j.status = 'running' AND j.lease_token = $2 AND j.lease_expires_at > clock_timestamp()
      AND EXISTS (SELECT 1 FROM ${this.table}.tasks t WHERE t.id = j.task_id AND t.requirements_version = j.requirements_version AND t.status NOT IN ('paused', 'cancelled')) RETURNING j.*`, [jobId, token, leaseMs])).rows[0];
    if (!row) throw new StoreError(409, 'The execution lease is no longer valid', 'stale_lease');
    return publicJob(row);
  }

  async _lockedJob(client, jobId) {
    const location = (await client.query(`SELECT task_id FROM ${this.table}.jobs WHERE id = $1`, [jobId])).rows[0];
    if (!location) throw new StoreError(404, 'Job not found', 'not_found');
    const task = await this._task(client, location.task_id, true);
    const job = (await client.query(`SELECT *, lease_expires_at > clock_timestamp() AS lease_valid FROM ${this.table}.jobs WHERE id = $1 FOR UPDATE`, [jobId])).rows[0];
    return { task, job };
  }

  _assertLease(task, job, token) {
    if (job.status !== 'running' || job.lease_token !== token || !job.lease_valid || job.requirements_version !== task.requirements_version || ['paused', 'cancelled', 'done'].includes(task.status)) {
      throw new StoreError(409, 'The execution lease is no longer valid', 'stale_lease');
    }
  }

  async recordRunExecution(jobId, token, patch) {
    id(jobId, 'jobId');
    id(token, 'token');
    object(patch, 'execution patch');
    return this.transaction(async (client) => {
      const { task, job } = await this._lockedJob(client, jobId);
      this._assertLease(task, job, token);
      const run = (await client.query(`SELECT * FROM ${this.table}.runs WHERE job_id = $1 AND lease_token = $2 FOR UPDATE`, [jobId, token])).rows[0];
      if (!run || run.status !== 'running') throw new StoreError(409, 'Execution not found', 'stale_lease');
      const normalized = executionPatch(patch, job.role, run.execution);
      return (await client.query(`UPDATE ${this.table}.runs SET execution = execution || $2::jsonb WHERE id = $1 RETURNING execution`, [run.id, JSON.stringify(normalized)])).rows[0].execution;
    });
  }

  async recordRunUsage(jobId, token, usage) {
    id(jobId, 'jobId'); id(token, 'token');
    let normalized;
    try { normalized = normalizeUsage(usage); } catch { throw new StoreError(400, 'Invalid token usage'); }
    return this.transaction(async client => {
      const { task, job } = await this._lockedJob(client, jobId);
      this._assertLease(task, job, token);
      const run = (await client.query(`SELECT id, status, usage FROM ${this.table}.runs WHERE job_id = $1 AND lease_token = $2 FOR UPDATE`, [jobId, token])).rows[0];
      if (!run || run.status !== 'running') throw new StoreError(409, 'Execution not found', 'stale_lease');
      if (run.usage !== null) {
        if (!isDeepStrictEqual(run.usage, normalized)) throw new StoreError(409, 'Reported token usage is immutable', 'usage_mismatch');
        return run.usage;
      }
      return (await client.query(`UPDATE ${this.table}.runs SET usage = $2::jsonb WHERE id = $1 RETURNING usage`, [run.id, JSON.stringify(normalized)])).rows[0].usage;
    });
  }

  async usageSummary({ taskId } = {}) {
    if (taskId !== undefined) id(taskId, 'taskId');
    const rows = (await this.pool.query(usageSummarySql(this.table), [taskId ?? null])).rows;
    const result = row => ({
      totals: usageTotals(row),
      reported_runs: Number(row?.reported_runs ?? 0),
      unreported_runs: Number(row?.total_runs ?? 0) - Number(row?.reported_runs ?? 0),
      legacy_reports: Number(row?.legacy_reports ?? 0),
    });
    const overall = rows.find(row => row.role === null);
    return {
      ...result(overall),
      by_role: rows.filter(row => row.role !== null).map(row => ({ role: row.role, ...result(row) })),
      coverage_started_at: overall?.coverage_started_at?.toISOString() ?? null,
    };
  }

  async recordRunProgress(jobId, token, patch, options = {}) {
    id(jobId, 'jobId'); id(token, 'token'); object(patch, 'progress patch');
    object(options, 'progress write options');
    if (Object.keys(options).some(key => key !== 'expectedProgress')) throw new StoreError(400, 'Unknown progress write option');
    if (Object.hasOwn(options, 'expectedProgress')) object(options.expectedProgress, 'expected progress');
    return this.transaction(async client => {
      const { task, job } = await this._lockedJob(client, jobId);
      this._assertLease(task, job, token);
      const run = (await client.query(`SELECT * FROM ${this.table}.runs WHERE job_id = $1 AND lease_token = $2 FOR UPDATE`, [jobId, token])).rows[0];
      if (!run || run.status !== 'running') throw new StoreError(409, 'Execution not found', 'stale_lease');
      if (Object.hasOwn(options, 'expectedProgress') && !isDeepStrictEqual(run.progress, options.expectedProgress)) {
        throw new StoreError(409, 'Progress changed since observation', 'stale_progress');
      }
      const normalized = progressPatch(patch, job.role, run.progress);
      return (await client.query(`UPDATE ${this.table}.runs SET progress = $2::jsonb WHERE id = $1 RETURNING progress`, [run.id, JSON.stringify(normalized)])).rows[0].progress;
    });
  }

  async finishJob(jobId, token, result) {
    id(jobId, 'jobId');
    id(token, 'token');
    object(result, 'result');
    string(result.summary, 'result summary');
    return this.transaction(async (client) => {
      const { task, job } = await this._lockedJob(client, jobId);
      const run = (await client.query(`SELECT * FROM ${this.table}.runs WHERE job_id = $1 AND lease_token = $2`, [jobId, token])).rows[0];
      if (run?.status === 'succeeded' && job.status === 'completed') return this._detail(client, task.id);
      this._assertLease(task, job, token);
      if (!run || run.status !== 'running') throw new StoreError(409, 'Execution not found', 'stale_lease');
      const settings = await this._settings(client);
      let status;
      let nextRole;
      let artifact = task.artifact;
      let spec = task.spec;
      let repairCount = task.repair_count;
      if (job.role === 'analyst') {
        spec = object(result.spec, 'analyst spec');
        const questions = result.questions ?? [];
        if (!Array.isArray(questions)) throw new StoreError(400, 'questions must be an array');
        if (!Array.isArray(spec.acceptance)) throw new StoreError(400, 'spec.acceptance must be an array');
        if (spec.subtasks !== undefined && !Array.isArray(spec.subtasks)) throw new StoreError(400, 'spec.subtasks must be an array');
        if (!questions.length && !spec.acceptance.length) throw new StoreError(400, 'At least one acceptance criterion is required');
        await client.query(`UPDATE ${this.table}.questions SET status = 'cancelled' WHERE task_id = $1 AND status = 'open'`, [task.id]);
        for (const question of [...new Set(questions.map((value) => string(typeof value === 'string' ? value : value?.text, 'question', 10_000)))]) {
          await client.query(`INSERT INTO ${this.table}.questions (id, task_id, requirements_version, text) VALUES ($1, $2, $3, $4)`, [randomUUID(), task.id, task.requirements_version, question]);
        }
        status = questions.length ? 'needs_answers' : 'ready';
        if (!questions.length && settings.auto_develop) nextRole = 'developer';
        artifact = {};
        repairCount = 0;
      } else if (job.role === 'developer') {
        const candidate = object(result.artifact, 'developer artifact');
        artifact = { developer: candidate, requirements_version: task.requirements_version };
        status = 'developing';
        nextRole = 'tester';
      } else if (job.role === 'tester') {
        if (typeof result.passed !== 'boolean') throw new StoreError(400, 'tester passed must be boolean');
        const bugs = result.bugs ?? [];
        if (!Array.isArray(bugs)) throw new StoreError(400, 'bugs must be an array');
        const evidence = object(result.artifact ?? {}, 'tester artifact');
        validateEvidence(artifact.developer, evidence);
        if (artifact.requirements_version !== task.requirements_version) throw new StoreError(409, 'The candidate belongs to older requirements', 'candidate_mismatch');
        if (result.passed && bugs.length) throw new StoreError(400, 'A passing report cannot contain unresolved bugs');
        const failedChecks = Array.isArray(evidence.checks) ? evidence.checks.filter(check => check?.passed === false) : [];
        if (result.passed && failedChecks.length) throw new StoreError(400, 'A passing report cannot contain failed checks');
        const verificationBlocked = !result.passed && !bugs.length && failedChecks.some(check =>
          typeof check.name === 'string' && check.name.trim() && check.name.length <= 2048
          && typeof check.detail === 'string' && check.detail.trim() && check.detail.length <= 8192);
        if (!result.passed && !bugs.length && !verificationBlocked) {
          throw new StoreError(400, 'A failing report must contain a reproducible defect or a concrete failed verification check');
        }
        artifact = { ...artifact, tester: { ...evidence, passed: result.passed, verification_blocked: verificationBlocked, run_id: run.id, requirements_version: task.requirements_version } };
        if (result.passed) {
          await client.query(`UPDATE ${this.table}.bugs SET status = 'closed', updated_at = clock_timestamp() WHERE task_id = $1 AND status = 'open'`, [task.id]);
          status = 'ready_release';
          if (settings.auto_release) nextRole = 'release';
        } else if (verificationBlocked) {
          status = 'needs_attention';
        } else {
          for (const bug of bugs) {
            object(bug, 'bug');
            const steps = bug.steps ?? [];
            if (!Array.isArray(steps) || !steps.length || steps.some((step) => typeof step !== 'string' || !step.trim())) throw new StoreError(400, 'Bug steps must contain reproduction steps');
            const severity = bug.severity ?? 'medium';
            if (!BUG_SEVERITIES.includes(severity)) throw new StoreError(400, 'Bug severity must be critical, high, medium or low');
            await client.query(`INSERT INTO ${this.table}.bugs (id, task_id, run_id, title, expected, actual, steps, severity) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
              [randomUUID(), task.id, run.id, string(bug.title, 'bug title', 300), string(bug.expected, 'expected behavior', 10_000), string(bug.actual, 'actual behavior', 10_000), JSON.stringify(steps), severity]);
          }
          if (repairCount < settings.max_repairs) {
            repairCount += 1;
            status = 'repairing';
            nextRole = 'developer';
          } else status = 'needs_attention';
        }
      } else if (job.role === 'release') {
        const evidence = object(result.artifact, 'release artifact');
        if (!artifact.tester?.passed || artifact.requirements_version !== task.requirements_version || artifact.tester.requirements_version !== task.requirements_version) {
          throw new StoreError(409, 'This candidate has no passing test report', 'qa_required');
        }
        validateEvidence(artifact.developer, artifact.tester);
        validateEvidence(artifact.developer, evidence);
        artifact = { ...artifact, release: evidence };
        status = 'done';
      }
      await client.query(`UPDATE ${this.table}.runs SET status = 'succeeded', result = $2::jsonb, finished_at = clock_timestamp() WHERE id = $1`, [run.id, JSON.stringify(result)]);
      await client.query(`UPDATE ${this.table}.jobs SET status = 'completed', lease_token = NULL, lease_expires_at = NULL, finished_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [job.id]);
      await client.query(`UPDATE ${this.table}.tasks SET status = $2, spec = $3::jsonb, artifact = $4::jsonb, repair_count = $5, updated_at = clock_timestamp() WHERE id = $1`, [task.id, status, JSON.stringify(spec), JSON.stringify(artifact), repairCount]);
      await this._event(client, task.id, 'job_completed', { job_id: job.id, run_id: run.id, role: job.role, summary: result.summary, status });
      if (nextRole) await this._enqueue(client, { ...task, status, spec, artifact, repair_count: repairCount }, nextRole, { repairing: status === 'repairing' });
      return this._detail(client, task.id);
    });
  }

  async _failure(client, task, job, token, error, { retryable = false, delayMs = 0, expired = false } = {}) {
    const status = expired ? 'expired' : 'failed';
    await client.query(`UPDATE ${this.table}.runs SET status = $3, error = $4, finished_at = clock_timestamp() WHERE job_id = $1 AND lease_token = $2 AND status = 'running'`, [job.id, token, status, error]);
    const retry = retryable && job.attempts < job.max_attempts;
    await client.query(`UPDATE ${this.table}.jobs SET status = $2, lease_token = NULL, lease_expires_at = NULL,
      available_at = clock_timestamp() + $3 * interval '1 millisecond', last_error = $4,
      finished_at = CASE WHEN $2 = 'failed' THEN clock_timestamp() ELSE NULL END, updated_at = clock_timestamp() WHERE id = $1`, [job.id, retry ? 'pending' : 'failed', delayMs, error]);
    if (!retry) await client.query(`UPDATE ${this.table}.tasks SET status = 'needs_attention', updated_at = clock_timestamp() WHERE id = $1`, [task.id]);
    await this._event(client, task.id, expired ? 'lease_expired' : 'job_failed', { job_id: job.id, role: job.role, attempt: job.attempts, retry, error });
    return this._detail(client, task.id);
  }

  async failJob(jobId, token, error, options = {}) {
    id(jobId, 'jobId');
    id(token, 'token');
    const message = string(typeof error === 'string' ? error : error?.message, 'error', 20_000);
    object(options, 'failure options');
    if (options.retryable !== undefined && typeof options.retryable !== 'boolean') throw new StoreError(400, 'retryable must be boolean');
    milliseconds(options.delayMs ?? 0, 'delayMs', true);
    return this.transaction(async (client) => {
      const { task, job } = await this._lockedJob(client, jobId);
      const previous = (await client.query(`SELECT status FROM ${this.table}.runs WHERE job_id = $1 AND lease_token = $2`, [jobId, token])).rows[0];
      if (previous?.status === 'failed') return this._detail(client, task.id);
      this._assertLease(task, job, token);
      return this._failure(client, task, job, token, message, options);
    });
  }

  async deferJob(jobId, token, error, options = {}) {
    id(jobId, 'jobId');
    id(token, 'token');
    const message = string(typeof error === 'string' ? error : error?.message, 'error', 20_000);
    object(options, 'deferral options');
    const delayMs = milliseconds(options.delayMs ?? 60_000, 'delayMs');
    return this.transaction(async (client) => {
      const { task, job } = await this._lockedJob(client, jobId);
      const run = (await client.query(`SELECT id, status FROM ${this.table}.runs WHERE job_id = $1 AND lease_token = $2`, [jobId, token])).rows[0];
      if (run?.status === 'failed') return this._detail(client, task.id);
      this._assertLease(task, job, token);
      if (!run || run.status !== 'running') throw new StoreError(409, 'Execution not found', 'stale_lease');
      await client.query(`UPDATE ${this.table}.runs SET status = 'failed', error = $2, finished_at = clock_timestamp() WHERE id = $1`, [run.id, message]);
      await client.query(`UPDATE ${this.table}.jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
        attempts = GREATEST(attempts - 1, 0), available_at = clock_timestamp() + $2 * interval '1 millisecond',
        last_error = $3, finished_at = NULL, updated_at = clock_timestamp() WHERE id = $1`, [jobId, delayMs, message]);
      await this._event(client, task.id, 'job_waiting', { job_id: jobId, run_id: run.id, role: job.role, delay_ms: delayMs, error: message });
      return this._detail(client, task.id);
    });
  }

  async recoverExpired() {
    return this.transaction(async (client) => {
      const tasks = (await client.query(`SELECT t.* FROM ${this.table}.tasks t WHERE EXISTS (
        SELECT 1 FROM ${this.table}.jobs j WHERE j.task_id = t.id AND j.status = 'running' AND j.lease_expires_at <= clock_timestamp()
      ) ORDER BY t.id FOR UPDATE OF t SKIP LOCKED`)).rows;
      const recovered = [];
      for (const task of tasks) {
        const job = (await client.query(`SELECT * FROM ${this.table}.jobs WHERE task_id = $1 AND status = 'running' AND lease_expires_at <= clock_timestamp() FOR UPDATE`, [task.id])).rows[0];
        if (!job) continue;
        await this._failure(client, task, job, job.lease_token, 'Worker lease expired', { retryable: job.role !== 'release', expired: true });
        recovered.push({ task_id: task.id, job_id: job.id, role: job.role });
      }
      return recovered;
    });
  }

  async answerQuestions(taskId, answers) {
    id(taskId);
    const entries = Array.isArray(answers)
      ? answers.map((value) => [value?.id ?? value?.question_id, value?.answer])
      : Object.entries(object(answers, 'answers'));
    if (!entries.length) throw new StoreError(400, 'At least one answer is required');
    for (const [questionId, answer] of entries) { id(questionId, 'question id'); string(answer, 'answer', 20_000); }
    return this.transaction(async (client) => {
      const task = await this._task(client, taskId, true);
      if (task.status !== 'needs_answers') throw new StoreError(409, 'This task is not waiting for answers', 'invalid_transition');
      let changed = false;
      for (const [questionId, answer] of entries) {
        const question = (await client.query(`SELECT * FROM ${this.table}.questions WHERE id = $1 AND task_id = $2 FOR UPDATE`, [questionId, taskId])).rows[0];
        if (!question) throw new StoreError(404, 'Question not found', 'not_found');
        if (question.status === 'cancelled') throw new StoreError(409, 'This question is no longer current', 'stale_question');
        if (question.answer !== answer.trim()) {
          changed = true;
          await client.query(`UPDATE ${this.table}.questions SET answer = $2, status = 'answered', answered_at = clock_timestamp() WHERE id = $1`, [questionId, answer.trim()]);
        }
      }
      const remaining = Number((await client.query(`SELECT count(*) FROM ${this.table}.questions WHERE task_id = $1 AND status = 'open'`, [taskId])).rows[0].count);
      const version = task.requirements_version + (changed ? 1 : 0);
      await client.query(`UPDATE ${this.table}.tasks SET requirements_version = $2, updated_at = clock_timestamp() WHERE id = $1`, [taskId, version]);
      await this._event(client, taskId, 'questions_answered', { question_ids: entries.map(([questionId]) => questionId), remaining, requirements_version: version }, 'user');
      if (!remaining) {
        await client.query(`UPDATE ${this.table}.tasks SET status = 'inbox' WHERE id = $1`, [taskId]);
        await this._enqueue(client, { ...task, status: 'inbox', requirements_version: version }, 'analyst');
      }
      return this._detail(client, taskId);
    });
  }

  async _recoveryPlan(client, task) {
    const latest = task.status === 'needs_attention'
      ? (await client.query(`SELECT role, result FROM ${this.table}.runs WHERE task_id = $1 ORDER BY started_at DESC, id DESC LIMIT 1`, [task.id])).rows[0]
      : null;
    return recoveryPlan(task, retryRole(latest));
  }

  async _assertReleaseEnabled(client) {
    const runtime = (await client.query(`SELECT value FROM ${this.table}.settings WHERE key = '_runtime'`)).rows[0]?.value;
    if (runtime?.release_enabled === false) throw new StoreError(409, RELEASE_DISABLED_REASON, 'release_disabled');
  }

  async _assertRuntime(client) {
    const row = (await client.query(`SELECT value FROM ${this.table}.settings WHERE key = '_runtime'`)).rows[0];
    const runtime = this._runtime(row?.value);
    if (!runtime.authenticated) throw new StoreError(409, 'Сначала подключи Codex по подписке.', 'runtime_unavailable');
    if (!runtime.available) throw new StoreError(409, runtime.error || 'Исполнитель пока недоступен. Подожди восстановления сервиса.', 'runtime_unavailable');
  }

  async _recoverTask(client, task, actionName, plan, { requireRuntime = false } = {}) {
    const expected = actionName === 'retry' ? 'needs_attention' : 'paused';
    if (task.status !== expected) throw new StoreError(409, `Only a ${expected} task can ${actionName}`, 'invalid_transition');
    if ((await client.query(`SELECT id FROM ${this.table}.jobs WHERE task_id = $1 AND status IN ('pending', 'running') FOR UPDATE`, [task.id])).rowCount) {
      throw new StoreError(409, 'Исполнитель уже работает над задачей.', 'active_job');
    }
    plan ??= await this._recoveryPlan(client, task);
    if (plan.role === 'release') {
      await this._assertReleaseEnabled(client);
      if (!task.artifact.tester?.passed || task.artifact.requirements_version !== task.requirements_version) throw new StoreError(409, 'Passing test evidence is required', 'qa_required');
      validateEvidence(task.artifact.developer, task.artifact.tester);
    }
    if (requireRuntime && plan.role) await this._assertRuntime(client);
    if (actionName === 'retry') {
      await client.query(`UPDATE ${this.table}.tasks SET status = $2, repair_count = $3, updated_at = clock_timestamp() WHERE id = $1`, [task.id, plan.status, plan.repairCount]);
      await this._enqueue(client, { ...task, status: plan.status, repair_count: plan.repairCount }, plan.role);
    } else {
      await client.query(`UPDATE ${this.table}.tasks SET status = $2, resume_status = NULL, updated_at = clock_timestamp() WHERE id = $1`, [task.id, plan.status]);
      if (plan.role) await this._enqueue(client, { ...task, status: plan.status }, plan.role, { repairing: plan.repairing });
    }
  }

  async action(taskId, actionName, { requireRuntime = false } = {}) {
    id(taskId);
    string(actionName, 'action', 100);
    if (actionName === 'approve_release') actionName = 'release';
    return this.transaction(async (client) => {
      const task = await this._task(client, taskId, true);
      if (actionName === 'analyze') {
        if (requireRuntime) await this._assertRuntime(client);
        await this._enqueue(client, task, 'analyst');
      } else if (actionName === 'start') {
        if (task.status !== 'ready') throw new StoreError(409, 'Only a ready task can enter development', 'invalid_transition');
        if (requireRuntime) await this._assertRuntime(client);
        await this._enqueue(client, task, 'developer');
      } else if (actionName === 'release') {
        if (task.status !== 'ready_release') throw new StoreError(409, 'Only a tested candidate can be released', 'invalid_transition');
        await this._assertReleaseEnabled(client);
        if (!task.artifact.tester?.passed || task.artifact.requirements_version !== task.requirements_version) throw new StoreError(409, 'Passing test evidence is required', 'qa_required');
        validateEvidence(task.artifact.developer, task.artifact.tester);
        if (requireRuntime) await this._assertRuntime(client);
        await this._enqueue(client, task, 'release');
      } else if (actionName === 'pause' || actionName === 'cancel') {
        if (['done', 'cancelled'].includes(task.status)) throw new StoreError(409, `Cannot ${actionName} a ${task.status} task`, 'invalid_transition');
        await this._revoke(client, taskId, `Task ${actionName === 'pause' ? 'paused' : 'cancelled'}`);
        const status = actionName === 'pause' ? 'paused' : 'cancelled';
        await client.query(`UPDATE ${this.table}.tasks SET status = $2, resume_status = $3, updated_at = clock_timestamp() WHERE id = $1`, [taskId, status, task.status === 'paused' ? task.resume_status : task.status]);
      } else if (actionName === 'resume' || actionName === 'retry') {
        await this._recoverTask(client, task, actionName, undefined, { requireRuntime });
      } else throw new StoreError(400, 'Unknown task action');
      await this._event(client, taskId, 'task_action', { action: actionName, previous_status: task.status }, 'user');
      return this._detail(client, taskId);
    });
  }
}

export default Store;
