import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Owner, Sessions } from '../lib/owner.mjs';
import { createApp } from '../server.mjs';
import { seedTasks } from '../seed.mjs';
import { DEFAULT_ROLE_PROFILES, ROLE_CATALOG } from '../lib/roles.mjs';

const isolatedEnvironment = process.env.NODE_ENV === 'test'
  && process.env.PGDATABASE === 'royal_test'
  && ['127.0.0.1', 'localhost'].includes(process.env.PGHOST);
let isolatedUrl = false;
try {
  const parsed = new URL(process.env.PG_URL || '');
  isolatedUrl = process.env.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    && parsed.pathname === '/royal_test';
} catch { /* A missing URL uses the isolated wrapper environment. */ }
const enabled = process.env.PG_URL ? isolatedUrl : isolatedEnvironment;
const integration = (name, callback) => test(name, { skip: !enabled }, callback);
const password = 'factory-integration-password';
const email = 'owner@example.com';

integration('board moves are owner-only and preserve CSRF, runtime and workflow guards', async t => {
  const { store, request, signIn } = await fixture(t);
  const task = await store.createTask({ title: 'Board move API' });
  const payload = { column_id: 'analysis', expected_status: 'inbox', before_task_id: null };
  assert.equal((await request(`/api/tasks/${task.id}/move`, { method: 'POST', body: payload })).status, 401);
  const cookie = await signIn();
  assert.equal((await request(`/api/tasks/${task.id}/move`, { method: 'POST', cookie, body: payload, headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const disconnected = await request(`/api/tasks/${task.id}/move`, { method: 'POST', cookie, body: payload });
  assert.equal(disconnected.status, 409);
  assert.match(disconnected.body.error, /подключи Codex/);
  const reordered = await request(`/api/tasks/${task.id}/move`, { method: 'POST', cookie, body: { ...payload, column_id: 'inbox' } });
  assert.equal(reordered.status, 200);
  assert.equal(reordered.body.board_column, 'inbox');
  assert.ok(Number.isInteger(reordered.body.board_position));
  await store.setRuntime({ authenticated: true, available: false });
  assert.equal((await request(`/api/tasks/${task.id}/move`, { method: 'POST', cookie, body: payload })).status, 409);
  await store.setRuntime({ authenticated: true, available: true });
  const moved = await request(`/api/tasks/${task.id}/move`, { method: 'POST', cookie, body: payload });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.status, 'analyzing');
  assert.deepEqual(moved.body.board_moves, ['analysis']);
  assert.equal((await request(`/api/tasks/${task.id}/move`, { method: 'POST', cookie, body: payload })).status, 409);
  const state = await request('/api/state', { cookie });
  assert.deepEqual(state.body.tasks.find(item => item.id === task.id).board_moves, ['analysis']);
  assert.equal((await request(`/api/tasks/${task.id}`, { cookie })).body.board_column, 'analysis');
});

integration('usage is owner-only, separates account limits from measured factory tokens, and refresh only queues a read',async t=>{
  const {store,request,signIn}=await fixture(t);
  assert.equal((await request('/api/usage')).status,401);
  assert.equal((await request('/api/usage/refresh',{method:'POST',body:{}})).status,401);
  const cookie=await signIn();
  const unknown=await request('/api/usage',{cookie});
  assert.equal(unknown.body.subscription.checked_at,null);
  assert.equal(unknown.body.factory.totals.total_tokens,null);
  const task=await store.createTask({title:'Measured task'});await store.action(task.id,'analyze');
  const claim=await store.claimJob('usage-api-test');
  await store.recordRunUsage(claim.job.id,claim.token,{input_tokens:100,output_tokens:20,cached_input_tokens:50});
  const usage=await request('/api/usage',{cookie});
  assert.equal(usage.body.factory.totals.total_tokens,120);
  assert.equal(usage.body.subscription.limits.length,0);
  const state=await request('/api/state',{cookie});
  assert.equal(state.body.usage.factory.totals.total_tokens,120);
  const detail=await request(`/api/tasks/${task.id}`,{cookie});
  assert.equal(detail.body.usage_summary.totals.total_tokens,120);
  assert.equal(detail.body.runs.at(-1).usage.total_tokens,120);
  assert.equal(JSON.stringify(usage.body).includes(claim.token),false);
  const refresh=await request('/api/usage/refresh',{method:'POST',cookie,body:{}});
  assert.equal(refresh.status,202);assert.equal(refresh.body.requested,true);
  assert.equal((await request('/api/usage/refresh',{method:'POST',cookie,body:{}})).body.requested,false);
  assert.equal((await store.getRuntime()).authenticated,false);
});

integration('live progress reaches authenticated detail and board without exposing lease or write controls', async (t) => {
  const { store, request, signIn } = await fixture(t);
  const cookie = await signIn();
  const task = await store.createTask({ title: 'Observable analysis' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('progress-api-test');
  const stamp = new Date().toISOString();
  const progress = { ...claim.run.progress, phase: 'model', phase_started_at: stamp, updated_at: stamp,
    model_started_at: stamp, last_activity_at: stamp, activity_kind: 'tool_completed', tool_calls: 2, tool_completed: 1 };
  await store.recordRunProgress(claim.job.id, claim.token, progress);

  const detail = await request(`/api/tasks/${task.id}`, { cookie });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.active_run.progress, progress);
  assert.deepEqual(detail.body.runs.at(-1).progress, progress);
  assert.equal(detail.body.active_run.id, claim.run.id);
  assert.ok(detail.body.active_run.lease_expires_at);
  const state = await request('/api/state', { cookie });
  assert.equal(state.status, 200);
  assert.deepEqual(state.body.tasks.find(item => item.id === task.id).active_run.progress, progress);
  for (const body of [detail.body, state.body]) {
    assert.ok(!JSON.stringify(body).includes(claim.token));
    assert.ok(!JSON.stringify(body).includes('lease_token'));
  }
  assert.equal((await request(`/api/tasks/${task.id}`)).status, 401);
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'PATCH', cookie, body: { progress: { phase: 'saving' } } })).status, 400);
  assert.deepEqual((await store.getTask(task.id)).active_run.progress, progress);
  await store.action(task.id, 'pause');
  assert.equal((await request(`/api/tasks/${task.id}`, { cookie })).body.active_run, null);
  assert.equal((await request('/api/state', { cookie })).body.tasks.find(item => item.id === task.id).active_run, null);
});

integration('owner can read current graph evidence while journals and execution leases remain private', async t => {
  const { store, request, signIn } = await fixture(t);
  assert.equal((await request('/api/knowledge-graph')).status, 401);
  const cookie = await signIn();
  const task = await store.createTask({ title: 'Graph gateway analysis' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('graph-api-test');
  const result = await request('/api/knowledge-graph', { cookie });
  assert.equal(result.status, 200);
  assert.equal(result.body.schema_version, 1);
  assert.ok(result.body.nodes.some(node => node.id === 'service:finance_gateway'));
  assert.ok(result.body.nodes.some(node => node.id === `task:${task.id}`));
  assert.equal(Object.hasOwn(result.body, 'events'), false);
  assert.ok(result.body.sync.event_count > 0);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes(claim.token), false);
  assert.equal(serialized.includes('lease_token'), false);
  assert.equal(serialized.includes('requested_model'), false);
  const search = await request('/api/knowledge-graph?q=finance-gateway', { cookie });
  assert.equal(search.status, 200);
  assert.ok(search.body.nodes.some(node => node.id === 'service:finance_gateway'));
  assert.ok(search.body.nodes.length < result.body.nodes.length);
  const unrelated = await request('/api/knowledge-graph?q=zzquerywithoutanymatchingknowledgezz', { cookie });
  assert.equal(unrelated.status, 200);
  assert.equal(unrelated.body.nodes.length, 0);
});

async function fixture(t) {
  const schema = `test_factory_api_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'royal-factory-api-'));
  const store = new Store({ connectionString: process.env.PG_URL || undefined, schema });
  await store.init(seedTasks);
  const owner = new Owner(directory);
  await owner.init();
  const bootstrap = (await owner.read()).bootstrap;
  const sessions = new Sessions(store.pool, schema);
  await sessions.init();
  const artifacts = join(directory, 'artifacts');
  await mkdir(artifacts);
  const options = { production: false, origin: 'http://127.0.0.1', prefix: '/team', artifacts };
  const app = await createApp({ store, owner, sessions, options });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  options.origin = origin;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(['GET', 'HEAD'].includes(method) ? {} : { Origin: origin }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }

  async function signIn() {
    const result = await request('/api/setup', { method: 'POST', body: { token: bootstrap, password, email } });
    assert.equal(result.status, 200);
    assert.ok(result.cookie);
    return result.cookie;
  }
  return { store, owner, sessions, request, signIn, bootstrap, origin, artifacts };
}

integration('API setup, sign-in, persistent sessions and logout require owner authentication', async (t) => {
  const { store, owner, request, bootstrap } = await fixture(t);
  assert.equal((await request('/healthz')).status, 200);
  assert.equal((await request('/api/state')).status, 401);
  assert.deepEqual((await request('/api/bootstrap')).body, { configured: false });
  assert.equal((await request('/api/setup', { method: 'POST', body: { token: 'wrong', password, email } })).status, 403);
  assert.equal((await request('/api/setup', { method: 'POST', body: { token: bootstrap, password: 'short', email } })).status, 400);
  assert.equal((await request('/api/setup', { method: 'POST', body: { token: bootstrap, password } })).status, 400);
  assert.equal((await request('/api/setup', { method: 'POST', body: { token: bootstrap, password, email: 'invalid' } })).status, 400);
  assert.equal(await owner.configured(), false);

  const setup = await request('/api/setup', { method: 'POST', body: { token: bootstrap, password, email: ' Owner@Example.COM ' } });
  assert.equal(setup.status, 200);
  assert.deepEqual(setup.body, { ok: true });
  assert.match(setup.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(setup.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.match(setup.headers.get('set-cookie'), /Path=\/team\//);
  assert.deepEqual((await request('/api/bootstrap')).body, { configured: true });
  assert.equal((await request('/api/setup', { method: 'POST', body: { token: bootstrap, password, email } })).status, 403);
  const wrongPassword = await request('/api/session', { method: 'POST', body: { password: 'wrong', email } });
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(wrongPassword.body, { error: 'Неверная почта или пароль.' });
  for (const invalidEmail of [undefined, null, {}, 123, 'invalid', 'another@example.com', 'owner@example.com\n']) {
    const denied = await request('/api/session', { method: 'POST', body: { password, email: invalidEmail } });
    assert.equal(denied.status, 401);
    assert.deepEqual(denied.body, wrongPassword.body);
    assert.equal(denied.cookie, undefined);
  }

  const login = await request('/api/session', { method: 'POST', body: { password, email: ' OWNER@Example.com ' } });
  assert.equal(login.status, 200);
  const sessionState = await request('/api/state', { cookie: login.cookie });
  assert.equal(sessionState.status, 200);
  assert.equal(sessionState.headers.get('cache-control'), 'no-store');
  const saved = await store.pool.query(`SELECT hash FROM "${store.schema}".owner_sessions`);
  assert.equal(saved.rowCount, 2);
  assert.ok(saved.rows.every((row) => row.hash !== setup.cookie.split('=')[1] && row.hash !== login.cookie.split('=')[1]));

  assert.equal((await request('/api/session/logout', { method: 'POST', cookie: setup.cookie })).status, 200);
  assert.equal((await request('/api/state', { cookie: setup.cookie })).status, 401);
  assert.equal((await request('/api/state', { cookie: login.cookie })).status, 200);
  assert.equal((await request('/api/session/logout', { method: 'POST', cookie: login.cookie })).status, 200);
  assert.equal((await request('/api/state', { cookie: login.cookie })).status, 401);
});

integration('binding legacy owner email preserves existing sessions and password credentials', async t => {
  const { owner, sessions, request, bootstrap } = await fixture(t);
  assert.equal(await owner.setup(bootstrap, password, email), true);
  const { email: previousEmail, ...legacy } = await owner.read();
  assert.equal(previousEmail, email);
  legacy.custom = { preserve: true };
  await owner.save(legacy);
  const cookie = `factory_session=${await sessions.create()}`;
  assert.equal((await request('/api/state', { cookie })).status, 200);
  assert.deepEqual((await request('/api/bootstrap')).body, { configured: true });
  const denied = await request('/api/session', { method: 'POST', body: { password, email } });
  assert.equal(denied.status, 401);
  assert.deepEqual(denied.body, { error: 'Неверная почта или пароль.' });
  assert.equal(await owner.bindEmail(' Owner@Example.COM '), true);
  assert.deepEqual(await owner.read(), { ...legacy, email });
  assert.equal((await request('/api/state', { cookie })).status, 200);
  assert.equal(await owner.verify(password, email), true);
  const missingEmail = await request('/api/session', { method: 'POST', body: { password } });
  assert.equal(missingEmail.status, 401);
  assert.deepEqual(missingEmail.body, denied.body);
  const login = await request('/api/session', { method: 'POST', body: { password, email } });
  assert.equal(login.status, 200);
  assert.equal((await request('/api/state', { cookie: login.cookie })).status, 200);
});

integration('concurrent setup requests configure exactly one owner email and password', async t => {
  const { owner, request, bootstrap } = await fixture(t);
  const candidates = [{ email, password }, { email: 'another@example.com', password: 'different-integration-password' }];
  const results = await Promise.all(candidates.map(candidate => request('/api/setup', {
    method: 'POST', body: { token: bootstrap, ...candidate },
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 403]);
  const winner = results.findIndex(result => result.status === 200);
  const loser = 1 - winner;
  assert.equal((await owner.read()).email, candidates[winner].email);
  assert.equal(await owner.verify(candidates[winner].password, candidates[winner].email), true);
  assert.equal(await owner.verify(candidates[loser].password, candidates[loser].email), false);
  assert.equal((await request('/api/state', { cookie: results[winner].cookie })).status, 200);
  assert.equal(results[loser].cookie, undefined);
});

integration('API rejects cross-site mutations including setup and logout', async (t) => {
  const { store, owner, request, signIn, bootstrap, origin } = await fixture(t);
  const externalOrigin = { Origin: 'https://untrusted.example' };
  const deniedSetup = await request('/api/setup', {
    method: 'POST', headers: externalOrigin, body: { token: bootstrap, password, email },
  });
  assert.equal(deniedSetup.status, 403);
  assert.equal(await owner.configured(), false);
  const cookie = await signIn();
  const before = (await store.listTasks()).length;
  assert.equal((await request('/api/tasks', {
    method: 'POST', cookie, headers: externalOrigin, body: { title: 'Cross-site task' },
  })).status, 403);
  assert.equal((await store.listTasks()).length, before);
  assert.equal((await request('/api/tasks', {
    method: 'POST', cookie, headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }, body: { title: 'Denied fetch context' },
  })).status, 403);
  assert.equal((await request('/api/session/logout', { method: 'POST', cookie, headers: externalOrigin })).status, 403);
  assert.equal((await request('/api/state', { cookie })).status, 200);
  assert.equal((await request('/api/tasks', { method: 'POST', cookie, body: { title: 'Same-origin task' } })).status, 201);
});

integration('API exposes exactly 22 seeded tasks and persists validated additions and edits', async (t) => {
  const { store, request, signIn } = await fixture(t);
  const cookie = await signIn();
  const state = await request('/api/state', { cookie });
  assert.equal(state.status, 200);
  assert.equal(state.body.tasks.length, 22);
  assert.ok(state.body.tasks.every((task) => task.status === 'inbox'));
  assert.equal(state.body.settings.auto_develop, false);
  assert.equal(state.body.settings.auto_release, false);
  assert.equal(state.body.runtime.authenticated, false);
  assert.deepEqual(state.body.role_catalog, ROLE_CATALOG);
  assert.deepEqual(state.body.settings.role_profiles, DEFAULT_ROLE_PROFILES);
  await store.init(seedTasks);
  assert.equal((await request('/api/state', { cookie })).body.tasks.length, 22);

  const created = await request('/api/tasks', {
    method: 'POST', cookie, body: { title: 'API task', description: 'Initial requirement', priority: 'P1' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'inbox');
  const edited = await request(`/api/tasks/${created.body.id}`, {
    method: 'PATCH', cookie, body: { description: 'Refined requirement', priority: 'P0' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.requirements_version, 2);
  assert.equal(edited.body.priority, 'P0');
  assert.equal((await request(`/api/tasks/${created.body.id}`, {
    method: 'PATCH', cookie, body: { status: 'done' },
  })).status, 400);
  const detail = await request(`/api/tasks/${created.body.id}`, { cookie });
  for (const key of ['questions', 'runs', 'events', 'bugs', 'jobs']) assert.ok(Array.isArray(detail.body[key]));
  assert.equal((await request(`/api/tasks/${randomUUID()}`, { cookie })).status, 404);
  assert.equal((await request('/api/tasks/invalid', { cookie })).status, 400);
  assert.equal((await request('/api/state', { cookie })).body.tasks.length, 23);
  assert.equal((await request('/api/settings', { method: 'POST', cookie, body: { auto_develop: true } })).status, 409);
  assert.equal((await request('/api/settings', { method: 'POST', cookie, body: { paused: true } })).body.paused, true);
});

integration('API saves strict role profiles atomically and exposes requested and observed run metadata', async (t) => {
  const { store, request, signIn } = await fixture(t);
  const cookie = await signIn();
  const profiles = structuredClone(DEFAULT_ROLE_PROFILES);
  profiles.analyst.model = 'gpt-6-astra';
  profiles.analyst.reasoning_effort = 'xhigh';
  const updated = await request('/api/settings', { method: 'POST', cookie, body: { role_profiles: profiles, paused: true } });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.role_profiles, profiles);
  assert.equal(updated.body.paused, true);
  assert.equal(updated.body.auto_develop, false);
  for (const invalid of [{ ...profiles, release: profiles.analyst }, { analyst: profiles.analyst },
    { ...profiles, analyst: { ...profiles.analyst, model: 'arbitrary-provider' } },
    { ...profiles, analyst: { ...profiles.analyst, skills: ['royal-testing'] } }]) {
    const result = await request('/api/settings', { method: 'POST', cookie, body: { role_profiles: invalid, paused: false } });
    assert.equal(result.status, 400);
    assert.equal((await store.getSettings()).paused, true);
    assert.deepEqual((await store.getSettings()).role_profiles, profiles);
  }
  const task = await store.createTask({ title: 'API execution metadata' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('api-metadata-worker');
  await store.recordRunExecution(claim.job.id, claim.token, { actual_model: 'gpt-6-astra', actual_effort: 'xhigh', observation_status: 'observed', skills: [{ id: 'royal-analysis', sha256: 'b'.repeat(64), version: '1.0.0' }] });
  await store.finishJob(claim.job.id, claim.token, { summary: 'Ready', questions: [], spec: { acceptance: ['Metadata is visible'], subtasks: [] } });
  const detail = await request(`/api/tasks/${task.id}`, { cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.runs[0].execution.requested_model, 'gpt-6-astra');
  assert.equal(detail.body.runs[0].execution.actual_model, 'gpt-6-astra');
  assert.equal(detail.body.runs[0].execution.skills[0].sha256, 'b'.repeat(64));
  assert.equal(Object.hasOwn(detail.body.runs[0], 'lease_token'), false);
});

integration('API queues analysis only for an authenticated live worker and resumes after answers', async (t) => {
  const { store, request, signIn } = await fixture(t);
  const cookie = await signIn();
  const created = await request('/api/tasks', { method: 'POST', cookie, body: { title: 'Language preferences' } });
  const taskId = created.body.id;
  const action = (name) => request(`/api/tasks/${taskId}/action`, { method: 'POST', cookie, body: { action: name } });
  assert.equal((await action('analyze')).status, 409);
  assert.equal((await store.getTask(taskId)).jobs.length, 0);
  await store.setRuntime({ authenticated: true, available: false, worker_status: 'unavailable', mode: 'chatgpt' });
  assert.equal((await action('analyze')).status, 409);
  await store.setRuntime({ authenticated: true, available: true, worker_status: 'idle', mode: 'chatgpt' });
  const queued = await action('analyze');
  assert.equal(queued.status, 200);
  assert.equal(queued.body.status, 'analyzing');
  assert.equal(queued.body.jobs.filter((job) => job.status === 'pending').length, 1);

  const analysis = await store.claimJob('integration-analyst');
  assert.equal(analysis.task.id, taskId);
  await store.finishJob(analysis.job.id, analysis.token, {
    summary: 'Language choices required', spec: { acceptance: [], subtasks: [] },
    questions: ['Which additional language?', 'Should selection persist?'],
  });
  const questions = (await request(`/api/tasks/${taskId}`, { cookie })).body;
  assert.equal(questions.status, 'needs_answers');
  assert.equal(questions.questions.length, 2);
  assert.equal(questions.runs[0].summary, 'Language choices required');
  assert.ok(questions.runs.every((run) => !Object.hasOwn(run, 'lease_token')));
  const partial = await request(`/api/tasks/${taskId}/answers`, {
    method: 'POST', cookie, body: { answers: { [questions.questions[0].id]: 'Russian' } },
  });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.status, 'needs_answers');
  const completed = await request(`/api/tasks/${taskId}/answers`, {
    method: 'POST', cookie, body: { answers: [{ id: questions.questions[1].id, answer: 'Yes' }] },
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, 'analyzing');
  assert.equal(completed.body.requirements_version, 3);
  const revised = await store.claimJob('integration-analyst');
  assert.equal(revised.job.requirements_version, 3);
  assert.equal(revised.task.questions.filter((question) => question.status === 'answered').length, 2);
  await store.finishJob(revised.job.id, revised.token, {
    summary: 'Scoped language selector', questions: [],
    spec: { acceptance: ['Russian can be selected', 'The selection persists after reload'], subtasks: [] },
  });
  assert.equal((await request(`/api/tasks/${taskId}`, { cookie })).body.status, 'ready');
  await store.pool.query(`UPDATE "${store.schema}".settings SET value = value || jsonb_build_object('updated_at', clock_timestamp() - interval '61 seconds') WHERE key = '_runtime'`);
  assert.equal((await action('start')).status, 409);
  assert.equal((await request('/api/state', { cookie })).body.runtime.authenticated, false);
  await store.setRuntime({ authenticated: true, available: true, worker_status: 'idle' });
  const developing = await action('start');
  assert.equal(developing.status, 200);
  assert.equal(developing.body.status, 'developing');
  assert.equal((await store.claimJob('integration-developer')).job.role, 'developer');
});

integration('API login request reports unavailable workers and persists a fresh login request', async (t) => {
  const { store, request, signIn } = await fixture(t);
  const cookie = await signIn();
  assert.equal((await request('/api/runtime/login', { method: 'POST', cookie })).status, 503);
  await store.setRuntime({ authenticated: false, available: true, worker_status: 'idle', login: { status: 'idle' } });
  const login = await request('/api/runtime/login', { method: 'POST', cookie });
  assert.equal(login.status, 202);
  assert.equal(login.body.requested, true);
  assert.match((await store.getSettings()).login_request, /^[a-f0-9-]{36}$/);
  assert.equal((await request('/api/runtime/login', { cookie })).body.authenticated, false);
  await store.setRuntime({ authenticated: true, available: true, worker_status: 'idle' });
  assert.equal((await request('/api/runtime/login', { method: 'POST', cookie })).body.authenticated, true);
  assert.equal((await request('/api/runtime/login', { cookie })).body.status, 'authenticated');
});

integration('API keeps checked changes ready and disables every release action', async (t) => {
  const { store, request, signIn } = await fixture(t);
  const cookie = await signIn();
  await store.setRuntime({ authenticated: true, available: true, worker_status: 'idle' });
  const task = await store.createTask({ title: 'Checked candidate' });
  await store.action(task.id, 'analyze');
  const analysis = await store.claimJob('integration-analyst');
  await store.finishJob(analysis.job.id, analysis.token, {
    summary: 'Ready', spec: { acceptance: ['The change works'], subtasks: [] }, questions: [],
  });
  await store.action(task.id, 'start');
  const development = await store.claimJob('integration-developer');
  const commit = 'a'.repeat(40);
  await store.finishJob(development.job.id, development.token, { summary: 'Implemented', artifact: { commit } });
  const testing = await store.claimJob('integration-tester');
  await store.finishJob(testing.job.id, testing.token, { summary: 'Verified', passed: true, bugs: [], artifact: { commit } });
  for (const action of ['approve_release', 'release']) {
    const denied = await request(`/api/tasks/${task.id}/action`, { method: 'POST', cookie, body: { action } });
    assert.equal(denied.status, 409, `Release alias ${action} must be disabled`);
    assert.match(denied.body.error, /отключена/);
  }
  await request('/api/settings', { method: 'POST', cookie, body: { auto_release: true } });
  assert.equal((await store.getSettings()).auto_release, false);
  const detail = await request(`/api/tasks/${task.id}`, { cookie });
  assert.equal(detail.body.status, 'ready_release');
  assert.equal(detail.body.jobs.filter((job) => job.status === 'pending' || job.status === 'running').length, 0);
  assert.equal(detail.body.artifact.tester.passed, true);
  assert.equal(detail.body.artifact.developer.commit, commit);
});

integration('API serves a candidate patch only to the owner and rejects unsafe metadata', async (t) => {
  const { store, request, signIn, origin, artifacts } = await fixture(t);
  const task = await store.createTask({ title: 'A downloadable checked change' });
  const path = `/api/tasks/${task.id}/patch`;
  assert.equal((await request(path)).status, 401);
  const cookie = await signIn();
  assert.equal((await request(path, { cookie })).status, 404);
  await store.action(task.id, 'analyze');
  const analysis = await store.claimJob('integration-analyst');
  await store.finishJob(analysis.job.id, analysis.token, {
    summary: 'Scoped change', questions: [], spec: { acceptance: ['The setting changes'], subtasks: [] },
  });
  await store.action(task.id, 'start');
  const development = await store.claimJob('integration-developer');
  const commit = 'a'.repeat(40);
  const filename = `${task.id}-${commit}.patch`;
  const content = 'diff --git a/settings.txt b/settings.txt\n--- a/settings.txt\n+++ b/settings.txt\n@@ -1 +1 @@\n-old\n+new\n';
  await writeFile(join(artifacts, filename), content);
  await store.finishJob(development.job.id, development.token, {
    summary: 'Candidate prepared', artifact: { commit, patch: { filename, bytes: Buffer.byteLength(content) } },
  });
  const download = await fetch(`${origin}${path}`, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), content);
  assert.match(download.headers.get('content-disposition'), new RegExp(`attachment; filename="royal-${task.id.slice(0, 8)}-${commit.slice(0, 8)}\\.patch"`));
  assert.equal(download.headers.get('content-length'), String(Buffer.byteLength(content)));
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.equal((await request(path)).status, 401);

  await store.pool.query(`UPDATE "${store.schema}".tasks SET artifact = jsonb_set(artifact, '{developer,patch,filename}', to_jsonb($2::text)) WHERE id = $1`, [task.id, '../owner.json']);
  assert.equal((await request(path, { cookie })).status, 404);
  await store.pool.query(`UPDATE "${store.schema}".tasks SET artifact = jsonb_set(jsonb_set(artifact, '{developer,patch,filename}', to_jsonb($2::text)), '{developer,commit}', to_jsonb($3::text)) WHERE id = $1`, [task.id, filename, 'b'.repeat(40)]);
  assert.equal((await request(path, { cookie })).status, 404);
  await store.pool.query(`UPDATE "${store.schema}".tasks SET artifact = jsonb_set(artifact, '{developer,commit}', to_jsonb($2::text)) WHERE id = $1`, [task.id, commit]);
  await rm(join(artifacts, filename));
  assert.equal((await request(path, { cookie })).status, 404);
});
