import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, StoreError } from '../lib/store.mjs';
import { DEFAULT_ROLE_PROFILES } from '../lib/roles.mjs';
import { initialProgress } from '../lib/progress.mjs';

const enabled = Boolean(process.env.PG_URL) || (process.env.NODE_ENV === 'test' && process.env.PGDATABASE === 'royal_test');
const integration = (name, callback) => test(name, { skip: !enabled }, callback);

async function fixture(t) {
  const schema = `factory_test_${randomUUID().replaceAll('-', '')}`;
  const store = new Store({ connectionString: process.env.PG_URL || undefined, schema });
  await store.init();
  t.after(async () => {
    await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await store.close();
  });
  return store;
}

const analysis = {
  summary: 'Scope and acceptance prepared',
  spec: { acceptance: ['The player sees the selected language'], subtasks: [{ title: 'Add a language selector' }] },
  questions: [],
};

const defect = {
  title: 'The selected language is lost after reload',
  expected: 'The chosen language is preserved',
  actual: 'English is selected after reload',
  steps: ['Select a language', 'Reload the page'],
  severity: 'high',
};

async function readyTask(store) {
  const task = await store.createTask({ title: 'Language selection', priority: 'P1' });
  await store.action(task.id, 'analyze');
  const claimed = await store.claimJob('analyst');
  await store.finishJob(claimed.job.id, claimed.token, analysis);
  return store.getTask(task.id);
}

async function candidate(store, taskId, identity = 'commit-a') {
  await store.action(taskId, 'start');
  const development = await store.claimJob('developer');
  await store.finishJob(development.job.id, development.token, {
    summary: 'Implementation prepared', artifact: { commit: identity, image_digest: 'sha256:image-a' },
  });
  return store.claimJob('tester');
}

const staleLease = (error) => error instanceof StoreError && error.status === 409 && error.code === 'stale_lease';

integration('invalid QA severity rolls back all bug, artifact, run and job state changes', async t => {
  const store = await fixture(t);
  const task = await readyTask(store);
  const testing = await candidate(store, task.id);
  const before = await store.getTask(task.id);
  const valid = { ...defect };
  for (const severity of ['', 'high: ' + 'Detailed defect rationale '.repeat(12), 'P1']) {
    await assert.rejects(store.finishJob(testing.job.id, testing.token, {
      summary: 'Findings', passed: false, artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' },
      bugs: [valid, { ...defect, title: 'Invalid severity', severity }],
    }), { status: 400 });
    assert.deepEqual(await store.getTask(task.id), before);
  }
  const defaulted = { ...defect }; delete defaulted.severity;
  await store.finishJob(testing.job.id, testing.token, {
    summary: 'Findings', passed: false, artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' }, bugs: [defaulted],
  });
  assert.equal((await store.getTask(task.id)).bugs[0].severity, 'medium');
});

function modelProgress(claim, extra = {}) {
  const stamp = new Date().toISOString();
  return { ...claim.run.progress, phase: 'model', phase_started_at: stamp, updated_at: stamp, model_started_at: stamp, ...extra };
}

integration('progress is public on current attempts while lease credentials and old attempts stay private', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Visible progress' });
  await store.action(task.id, 'analyze');
  assert.equal((await store.getTask(task.id)).active_run, null);
  const claim = await store.claimJob('progress-worker');
  const before = await store.getTask(task.id);
  assert.equal(before.active_run.id, claim.run.id);
  assert.equal(before.active_run.progress.phase, 'preparing');
  assert.equal(Object.hasOwn(before.active_run, 'lease_token'), false);
  assert.equal(JSON.stringify(before).includes(claim.token), false);
  const patch = modelProgress(claim);
  await store.recordRunProgress(claim.job.id, claim.token, patch);
  const detail = await store.getTask(task.id);
  const listed = (await store.listTasks()).find(value => value.id === task.id);
  assert.deepEqual(detail.active_run, listed.active_run);
  assert.deepEqual(detail.active_run.progress, patch);
  assert.equal(detail.updated_at.toISOString(), before.updated_at.toISOString());
  const last = { ...patch, phase: 'saving', phase_started_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await store.recordRunProgress(claim.job.id, claim.token, last);
  await store.finishJob(claim.job.id, claim.token, analysis);
  assert.equal((await store.getTask(task.id)).active_run, null);
  assert.deepEqual((await store.getTask(task.id)).runs[0].progress, last);
  await store.action(task.id, 'analyze');
  const next = await store.claimJob('next-progress-worker');
  await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, patch), staleLease);
  const current = await store.getTask(task.id);
  assert.equal(current.active_run.id, next.run.id);
  assert.equal(current.active_run.progress.model_started_at, null);
  assert.equal(current.active_run.progress.tool_calls, 0);
});

integration('browser checks remain visible before the tester model and cannot move back to server checks', async t => {
  const store = await fixture(t);
  const task = await readyTask(store);
  const testing = await candidate(store, task.id);
  let time = Date.parse(testing.run.progress.updated_at);
  let progress = { ...testing.run.progress };
  for (const phase of ['build', 'server_tests', 'browser_tests']) {
    const stamp = new Date(++time).toISOString();
    progress = { ...progress, phase, phase_started_at: stamp, updated_at: stamp };
    await store.recordRunProgress(testing.job.id, testing.token, progress);
  }
  const before = await store.getTask(task.id);
  assert.equal(before.active_run.progress.phase, 'browser_tests');
  assert.equal(before.active_run.progress.model_started_at, null);
  assert.equal(before.active_run.progress.last_activity_at, null);
  assert.equal(before.active_run.progress.tool_calls, 0);
  assert.deepEqual((await store.listTasks()).find(value => value.id === task.id).active_run.progress, before.active_run.progress);
  const nextStamp = new Date(++time).toISOString();
  await assert.rejects(store.recordRunProgress(testing.job.id, testing.token, {
    ...progress, phase: 'server_tests', phase_started_at: nextStamp, updated_at: nextStamp,
  }), { code: 'stale_progress' });
  assert.deepEqual(await store.getTask(task.id), before);
  await store.recordRunProgress(testing.job.id, testing.token, {
    ...progress, phase: 'model', phase_started_at: nextStamp, updated_at: nextStamp, model_started_at: nextStamp,
  });
  assert.equal((await store.getTask(task.id)).active_run.progress.model_started_at, nextStamp);
});

integration('progress writes reject lease owner, expiry, cancellation and revised requirements', async t => {
  const store = await fixture(t);
  for (const condition of ['owner', 'expiry', 'cancel', 'requirements']) {
    const task = await store.createTask({ title: `Progress fence ${condition}` });
    await store.action(task.id, 'analyze');
    const claim = await store.claimJob('fenced-progress');
    let token = claim.token;
    if (condition === 'owner') token = randomUUID();
    if (condition === 'expiry') await store.pool.query(`UPDATE "${store.schema}".jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [claim.job.id]);
    if (condition === 'cancel') await store.action(task.id, 'cancel');
    if (condition === 'requirements') await store.pool.query(`UPDATE "${store.schema}".tasks SET requirements_version = requirements_version + 1 WHERE id = $1`, [task.id]);
    await assert.rejects(store.recordRunProgress(claim.job.id, token, modelProgress(claim)), staleLease);
    assert.equal((await store.getTask(task.id)).runs[0].progress.phase, 'preparing');
    if (condition !== 'cancel') await store.action(task.id, 'cancel');
  }
});

integration('progress validation rejects text payloads, arbitrary limits, counters and out-of-order observations', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Safe progress' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('safe-progress');
  const base = modelProgress(claim);
  for (const invalid of [{ ...base, phase: 'running-command' }, { ...base, text: 'Bearer private' },
    { ...base, last_activity_at: 'private' }, { ...base, activity_kind: 'secret' }, { ...base, timeout_ms: 999 },
    { ...base, tool_calls: -1 }, { ...base, tool_completed: 1 }, { ...base, model_started_at: null }]) {
    await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, invalid), { status: 400 });
  }
  const active = { ...base, activity_kind: 'tool_running', last_activity_at: base.updated_at, tool_calls: 2, tool_completed: 1 };
  await store.recordRunProgress(claim.job.id, claim.token, active);
  const stamp = new Date(Date.parse(base.updated_at) + 1).toISOString();
  await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, { ...active, updated_at: stamp, tool_calls: 1 }), { code: 'stale_progress' });
  await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, { ...active, updated_at: stamp, model_started_at: stamp }), { code: 'stale_progress' });
  const saving = { ...active, phase: 'saving', phase_started_at: stamp, updated_at: stamp };
  await store.recordRunProgress(claim.job.id, claim.token, saving);
  await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, { ...active, updated_at: stamp }), { code: 'stale_progress' });
  assert.deepEqual((await store.getTask(task.id)).active_run.progress, saving);
});

integration('progress migration is repeatable and never invents activity for historical runs', async t => {
  const store = await fixture(t);
  const task = await readyTask(store);
  await store.pool.query(`ALTER TABLE "${store.schema}".runs DROP COLUMN progress`);
  await store.init(); await store.init();
  assert.deepEqual((await store.getTask(task.id)).runs[0].progress, {});
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('after-migration');
  assert.deepEqual(Object.keys(claim.run.progress).sort(), Object.keys(initialProgress('analyst')).sort());
  assert.equal(claim.run.progress.phase, 'preparing');
});

integration('progress observers atomically compare their snapshot and cannot overwrite another writer', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Legacy observer CAS' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('observer-cas');
  await store.pool.query(`UPDATE "${store.schema}".runs SET progress = '{}'::jsonb WHERE id = $1`, [claim.run.id]);
  const first = modelProgress(claim);
  await store.recordRunProgress(claim.job.id, claim.token, first, { expectedProgress: {} });
  const stamp = new Date(Date.parse(first.updated_at) + 1).toISOString();
  const advanced = { ...first, updated_at: stamp, last_activity_at: stamp, activity_kind: 'tool_running', tool_calls: 1 };
  const unorderedSnapshot = Object.fromEntries(Object.entries(first).reverse());
  await store.recordRunProgress(claim.job.id, claim.token, advanced, { expectedProgress: unorderedSnapshot });
  const later = new Date(Date.parse(stamp) + 1).toISOString();
  const candidate = { ...advanced, updated_at: later, last_activity_at: later, tool_calls: 2 };
  await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, candidate, { expectedProgress: first }), { code: 'stale_progress' });
  assert.deepEqual((await store.getTask(task.id)).active_run.progress, advanced);
  await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, candidate, { expectedProgress: {} }), { code: 'stale_progress' });
  await assert.rejects(store.recordRunProgress(claim.job.id, claim.token, candidate, { untrusted_option: 'secret' }), { status: 400 });
});

integration('role profiles persist atomically and each claim snapshots its selected configuration', async (t) => {
  const store = await fixture(t);
  assert.deepEqual((await store.getSettings()).role_profiles, DEFAULT_ROLE_PROFILES);
  const profiles = structuredClone(DEFAULT_ROLE_PROFILES);
  profiles.analyst = { model: 'gpt-6-astra', reasoning_effort: 'xhigh', skills: ['royal-analysis'] };
  await store.updateSettings({ role_profiles: profiles, max_job_attempts: 4 });
  const task = await store.createTask({ title: 'Configured analysis' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('configured-worker');
  const expected = { requested_model: 'gpt-6-astra', requested_effort: 'xhigh', requested_skills: ['royal-analysis'], actual_model: null, actual_effort: null, skills: [] };
  assert.deepEqual(claim.execution, expected);
  assert.deepEqual(claim.run.execution, expected);
  assert.deepEqual(claim.task.runs[0].execution, expected);
  profiles.analyst = { model: 'gpt-6-luna', reasoning_effort: 'low', skills: [] };
  await store.updateSettings({ role_profiles: profiles });
  assert.equal((await store.getSettings()).max_job_attempts, 4);
  assert.deepEqual((await store.getTask(task.id)).runs[0].execution, expected);
  await store.finishJob(claim.job.id, claim.token, analysis);
  await store.action(task.id, 'analyze');
  const next = await store.claimJob('configured-worker');
  assert.equal(next.execution.requested_model, 'gpt-6-luna');
  assert.equal(next.execution.requested_effort, 'low');
  assert.deepEqual(next.execution.requested_skills, []);
  const invalid = structuredClone(profiles);
  invalid.tester.skills = ['royal-development'];
  await assert.rejects(store.updateSettings({ auto_develop: true, role_profiles: invalid }), { status: 400 });
  assert.equal((await store.getSettings()).auto_develop, false);
  assert.deepEqual((await store.getSettings()).role_profiles, profiles);
});

integration('execution observations preserve requested fields and remain visible after completion', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Observed analysis' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('observed-worker');
  const patch = { actual_model: 'gpt-6.1-sol', actual_effort: 'medium', thread_id: randomUUID(), observation_status: 'observed',
    skills: [{ id: 'royal-analysis', sha256: 'a'.repeat(64), version: '1.0.0' }] };
  const observed = await store.recordRunExecution(claim.job.id, claim.token, patch);
  assert.deepEqual(observed, { ...claim.execution, ...patch });
  await store.recordRunExecution(claim.job.id, claim.token, { observation_status: 'observed' });
  assert.deepEqual((await store.getTask(task.id)).runs[0].execution, observed);
  for (const invalid of [{ requested_model: 'gpt-6-luna' }, { actual_model: '../model' }, { actual_effort: 'infinite' },
    { thread_id: 'untrusted text' }, { observation_status: 'invented' },
    { skills: [{ id: 'royal-testing', sha256: 'a'.repeat(64), version: '1.0.0' }] },
    { skills: [{ id: 'royal-analysis', sha256: 'invalid', version: '1.0.0' }] },
    { skills: [{ id: 'royal-analysis', sha256: 'a'.repeat(64), version: '1.0.0', path: '/auth' }] }]) {
    await assert.rejects(store.recordRunExecution(claim.job.id, claim.token, invalid), { status: 400 });
  }
  assert.deepEqual((await store.getTask(task.id)).runs[0].execution, observed);
  await store.finishJob(claim.job.id, claim.token, analysis);
  const detail = await store.getTask(task.id);
  assert.deepEqual(detail.runs[0].execution, observed);
  assert.equal(Object.hasOwn(detail.runs[0], 'lease_token'), false);
  await assert.rejects(store.recordRunExecution(claim.job.id, claim.token, { actual_model: 'other' }), staleLease);
});

integration('execution knowledge snapshots are immutable, validated and preserved after completion', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Project context provenance' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('context-worker');
  const project_knowledge = { version: '2026.10.10', sha256: 'a'.repeat(64), updated_at: '2026-10-10T00:00:00.000Z', document_count: 5, missing_documents: ['docs/current.md'] };
  const task_memory = { sha256: 'b'.repeat(64), answer_count: 2, delivery_count: 1 };
  for (const invalid of [
    { project_knowledge: { ...project_knowledge, version: '../unsafe' } },
    { project_knowledge: { ...project_knowledge, sha256: 'incorrect' } },
    { project_knowledge: { ...project_knowledge, updated_at: '2026-02-31T00:00:00.000Z' } },
    { project_knowledge: { ...project_knowledge, document_count: 33 } },
    { project_knowledge: { ...project_knowledge, missing_documents: ['docs/../auth.md'] } },
    { project_knowledge: { ...project_knowledge, missing_documents: ['/tmp/auth.md'] } },
    { project_knowledge: { ...project_knowledge, missing_documents: ['docs/auth.json'] } },
    { project_knowledge: { ...project_knowledge, missing_documents: ['docs/a.md', 'docs/a.md'] } },
    { project_knowledge: { ...project_knowledge, credentials: 'must not enter metadata' } },
    { task_memory: { ...task_memory, answer_count: 101 } },
    { task_memory: { ...task_memory, delivery_count: 1.5 } },
    { task_memory: { ...task_memory, content: 'must not enter metadata' } },
    { project_knowledge: null }, { task_memory: { sha256: 'b'.repeat(64), answer_count: 0 } },
  ]) await assert.rejects(store.recordRunExecution(claim.job.id, claim.token, invalid), { status: 400 });
  const recorded = await store.recordRunExecution(claim.job.id, claim.token, { project_knowledge, task_memory });
  assert.deepEqual(recorded, { ...claim.execution, project_knowledge, task_memory });
  assert.deepEqual(await store.recordRunExecution(claim.job.id, claim.token, { task_memory, project_knowledge }), recorded);
  for (const changed of [
    { project_knowledge: { ...project_knowledge, sha256: 'c'.repeat(64) } },
    { project_knowledge: { ...project_knowledge, updated_at: '2026-10-11T00:00:00.000Z' } },
    { project_knowledge: { ...project_knowledge, missing_documents: [] } },
    { task_memory: { ...task_memory, sha256: 'c'.repeat(64) } },
    { task_memory: { ...task_memory, answer_count: 3 } },
  ]) await assert.rejects(store.recordRunExecution(claim.job.id, claim.token, changed), { status: 409, code: 'context_mismatch' });
  await store.recordRunExecution(claim.job.id, claim.token, { actual_model: 'gpt-6.1-sol' });
  await store.finishJob(claim.job.id, claim.token, analysis);
  const execution = (await store.getTask(task.id)).runs[0].execution;
  assert.deepEqual(execution.project_knowledge, project_knowledge);
  assert.deepEqual(execution.task_memory, task_memory);
  assert.equal(execution.actual_model, 'gpt-6.1-sol');
});

integration('project memory shares bounded human decisions and verified delivery states without credentials', async t => {
  const store = await fixture(t);
  const decision = await store.createTask({ title: 'Payment decisions' });
  await store.action(decision.id, 'analyze');
  const analyst = await store.claimJob('analyst');
  const waiting = await store.finishJob(analyst.job.id, analyst.token, {
    summary: 'Needs a human choice', spec: { acceptance: [], subtasks: [] }, questions: ['Which provider?', 'Which network?'],
  });
  const humanAnswer = 'Existing gateway. CODEX_SALE_API_KEY="top-secret-value with spaces"; Bearer credential123; postgres://reader:dbpass123@database:5432/royal; api_key=provider123; token=session123; X-API-Key: header123; cookie=privatecookie123; sk-sensitive12345; -----BEGIN OPENSSH PRIVATE KEY-----\nprivate-material123\n-----END OPENSSH PRIVATE KEY----- ' + 'Подтвержденный ответ "\\". '.repeat(500);
  await store.answerQuestions(decision.id, { [waiting.questions[0].id]: humanAnswer });
  const planned = await readyTask(store);
  const candidateTask = await readyTask(store);
  const testing = await candidate(store, candidateTask.id, 'a'.repeat(40));
  await store.finishJob(testing.job.id, testing.token, {
    summary: 'Verified in isolation, not released. password="test-secret with spaces"', passed: true, bugs: [],
    artifact: { commit: 'a'.repeat(40), image_digest: 'sha256:image-a', raw_private_data: 'not memory content' },
  });
  const releasedTask = await readyTask(store);
  const releasedTesting = await candidate(store, releasedTask.id, 'b'.repeat(40));
  await store.finishJob(releasedTesting.job.id, releasedTesting.token, {
    summary: 'Verified release candidate', passed: true, bugs: [], artifact: { commit: 'b'.repeat(40), image_digest: 'sha256:image-a' },
  });
  await store.action(releasedTask.id, 'release');
  const release = await store.claimJob('release');
  await store.finishJob(release.job.id, release.token, {
    summary: 'Released successfully', artifact: { commit: 'b'.repeat(40), image_digest: 'sha256:image-a' },
  });
  const failed = await store.createTask({ title: 'Failed inference' });
  await store.action(failed.id, 'analyze');
  const failedRun = await store.claimJob('analyst');
  await store.failJob(failedRun.job.id, failedRun.token, 'Unverified implementation claim');
  const memory = await store.projectMemory({ excludeTaskId: planned.id });
  assert.equal(memory.answers.length, 1);
  assert.equal(memory.answers[0].task_id, decision.id);
  assert.equal(memory.answers[0].text, 'Which provider?');
  assert.match(memory.answers[0].answer, /\[redacted\]/);
  assert.ok(memory.answers[0].answered_at);
  assert.equal(memory.deliveries.length, 2);
  assert.equal(memory.deliveries.find(record => record.task_id === candidateTask.id).state, 'candidate_awaiting_release');
  assert.equal(memory.deliveries.find(record => record.task_id === releasedTask.id).state, 'released');
  assert.equal(memory.deliveries.find(record => record.task_id === candidateTask.id).commit_sha, 'a'.repeat(40));
  const serialized = JSON.stringify(memory);
  for (const forbidden of ['top-secret-value', 'credential123', 'dbpass123', 'provider123', 'session123', 'header123', 'privatecookie123', 'private-material123', 'sk-sensitive12345', 'test-secret', 'not memory content', 'Unverified implementation claim']) assert.equal(serialized.includes(forbidden), false);
  assert.ok([...memory.answers, ...memory.deliveries].every(record => Buffer.byteLength(JSON.stringify(record)) <= 4096));
  assert.equal((await store.projectMemory({ excludeTaskId: decision.id })).answers.length, 0);
  assert.equal((await store.projectMemory({ excludeTaskId: candidateTask.id })).deliveries.length, 1);
  assert.deepEqual(await store.projectMemory({ limit: 0 }), { answers: [], deliveries: [] });
  await assert.rejects(store.projectMemory({ limit: 21 }), { status: 400 });
  await assert.rejects(store.projectMemory({ excludeTaskId: '../unsafe' }), { status: 400 });
});

integration('execution metadata is fenced by lease owner, expiry, revocation and requirements revision', async (t) => {
  const store = await fixture(t);
  for (const condition of ['owner', 'expiry', 'revocation', 'requirements']) {
    const task = await store.createTask({ title: `Fenced observation ${condition}` });
    await store.action(task.id, 'analyze');
    const claim = await store.claimJob('fenced-worker');
    let token = claim.token;
    if (condition === 'owner') token = randomUUID();
    if (condition === 'expiry') await store.pool.query(`UPDATE "${store.schema}".jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [claim.job.id]);
    if (condition === 'revocation') await store.action(task.id, 'pause');
    if (condition === 'requirements') await store.pool.query(`UPDATE "${store.schema}".tasks SET requirements_version = requirements_version + 1 WHERE id = $1`, [task.id]);
    await assert.rejects(store.recordRunExecution(claim.job.id, token, { actual_model: 'gpt-6.1-sol' }), staleLease);
    assert.equal((await store.getTask(task.id)).runs[0].execution.actual_model, null);
    if (condition !== 'revocation') await store.action(task.id, 'cancel');
  }
});

integration('execution migration is idempotent and does not invent metadata for historical runs', async (t) => {
  const store = await fixture(t);
  const task = await readyTask(store);
  await store.pool.query(`ALTER TABLE "${store.schema}".runs DROP COLUMN execution`);
  await store.init();
  await store.init();
  assert.deepEqual((await store.getTask(task.id)).runs[0].execution, {});
  assert.deepEqual((await store.getSettings()).role_profiles, DEFAULT_ROLE_PROFILES);
});

integration('seeding is atomic and happens once across concurrent initializations', async (t) => {
  const store = await fixture(t);
  const seeds = Array.from({ length: 22 }, (_, index) => ({ title: `Imported task ${index + 1}` }));
  const results = await Promise.all([store.seedTasks(seeds), store.seedTasks(seeds)]);
  assert.equal(results.filter((result) => result.seeded).length, 1);
  assert.equal((await store.listTasks()).length, 22);
  await store.init(seeds);
  assert.equal((await store.listTasks()).length, 22);
  assert.equal((await store.getSettings()).auto_develop, false);
  assert.equal((await store.getSettings()).auto_release, false);
});

integration('questions pause development and all answers create a new analysis revision', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Payment requirements' });
  await store.action(task.id, 'analyze');
  const run = await store.claimJob('analyst');
  const waiting = await store.finishJob(run.job.id, run.token, {
    summary: 'Two choices are required', spec: { acceptance: [], subtasks: [] },
    questions: ['Which network?', 'Which settlement token?'],
  });
  assert.equal(waiting.status, 'needs_answers');
  assert.equal(await store.claimJob('developer'), null);
  const partial = await store.answerQuestions(task.id, { [waiting.questions[0].id]: 'TRON' });
  assert.equal(partial.status, 'needs_answers');
  assert.equal(partial.requirements_version, 2);
  const complete = await store.answerQuestions(task.id, [{ id: waiting.questions[1].id, answer: 'USDT' }]);
  assert.equal(complete.status, 'analyzing');
  assert.equal(complete.requirements_version, 3);
  const reanalysis = await store.claimJob('analyst');
  assert.equal(reanalysis.job.requirements_version, 3);
  assert.equal(reanalysis.task.questions.filter((question) => question.status === 'answered').length, 2);
  const ready = await store.finishJob(reanalysis.job.id, reanalysis.token, analysis);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.jobs.filter((job) => job.status === 'pending').length, 0);
  assert.equal(ready.spec.subtasks.length, 1);
  assert.equal((await store.listTasks()).length, 1);
});

integration('reanalysis while awaiting answers preserves human decisions and requirement version', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Reuse the existing gateway' });
  await store.action(task.id, 'analyze');
  const original = await store.claimJob('analyst');
  const waiting = await store.finishJob(original.job.id, original.token, {
    summary: 'Questions before project context was available', spec: { acceptance: [], subtasks: [] },
    questions: ['Which network?', 'Which gateway?'],
  });
  const answered = await store.answerQuestions(task.id, { [waiting.questions[0].id]: 'Nile test network' });
  const rerun = await store.action(task.id, 'analyze');
  assert.equal(rerun.status, 'analyzing');
  assert.equal(rerun.requirements_version, answered.requirements_version);
  assert.equal(rerun.questions.find(question => question.id === waiting.questions[1].id).status, 'open');
  const claim = await store.claimJob('analyst');
  assert.equal(claim.task.questions.find(question => question.id === waiting.questions[0].id).answer, 'Nile test network');
  const completed = await store.finishJob(claim.job.id, claim.token, {
    ...analysis, summary: 'The existing gateway is documented and will be reused',
  });
  assert.equal(completed.requirements_version, answered.requirements_version);
  assert.equal(completed.status, 'ready');
  assert.equal(completed.questions.find(question => question.id === waiting.questions[0].id).status, 'answered');
  assert.equal(completed.questions.find(question => question.id === waiting.questions[0].id).answer, 'Nile test network');
  assert.equal(completed.questions.find(question => question.id === waiting.questions[1].id).status, 'cancelled');
  assert.equal(completed.questions.filter(question => question.status === 'open').length, 0);
});

integration('a worker claim is exclusive and callbacks are idempotent', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Exclusive task' });
  await store.action(task.id, 'analyze');
  const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => store.claimJob(`worker-${index}`)));
  const winner = claims.find(Boolean);
  assert.equal(claims.filter(Boolean).length, 1);
  await store.finishJob(winner.job.id, winner.token, analysis);
  await store.finishJob(winner.job.id, winner.token, analysis);
  const detail = await store.getTask(task.id);
  assert.equal(detail.runs.length, 1);
  assert.equal(detail.events.filter((event) => event.type === 'job_completed').length, 1);
  assert.ok(!Object.hasOwn(detail.runs[0], 'lease_token'));
  assert.ok(!Object.hasOwn(detail.jobs[0], 'lease_token'));
});

integration('finished development and its test job are committed together', async (t) => {
  const store = await fixture(t);
  const task = await readyTask(store);
  const testing = await candidate(store, task.id);
  assert.equal(testing.task.status, 'testing');
  assert.equal(testing.task.artifact.developer.commit, 'commit-a');
  assert.equal(testing.task.runs.filter((run) => run.role === 'developer' && run.status === 'succeeded').length, 1);
  await store.finishJob(testing.job.id, testing.token, {
    summary: 'Acceptance and regression checks passed', passed: true, bugs: [],
    artifact: { commit_sha: 'commit-a', image_digest: 'sha256:image-a', checks: ['reload'] },
  });
  const reviewed = await store.getTask(task.id);
  assert.equal(reviewed.status, 'ready_release');
  assert.equal(reviewed.jobs.filter((job) => job.status === 'pending').length, 0);
  await store.action(task.id, 'approve_release');
  const release = await store.claimJob('release');
  await store.finishJob(release.job.id, release.token, {
    summary: 'The reviewed image is installed', artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' },
  });
  assert.equal((await store.getTask(task.id)).status, 'done');
});

integration('QA and release reject a different candidate or Docker image', async (t) => {
  const store = await fixture(t);
  const task = await readyTask(store);
  const testing = await candidate(store, task.id);
  const qa = { summary: 'Reviewed', passed: true, bugs: [], artifact: { commit: 'different', image_digest: 'sha256:image-a' } };
  await assert.rejects(store.finishJob(testing.job.id, testing.token, qa), (error) => error.code === 'candidate_mismatch');
  assert.equal((await store.getTask(task.id)).status, 'testing');
  qa.artifact.commit = 'commit-a';
  qa.artifact.image_digest = 'sha256:different';
  await assert.rejects(store.finishJob(testing.job.id, testing.token, qa), (error) => error.code === 'candidate_mismatch');
  qa.artifact.image_digest = 'sha256:image-a';
  await store.finishJob(testing.job.id, testing.token, qa);
  await store.action(task.id, 'release');
  const release = await store.claimJob('release');
  await assert.rejects(store.finishJob(release.job.id, release.token, {
    summary: 'Installed', artifact: { commit: 'another', image_digest: 'sha256:image-a' },
  }), (error) => error.code === 'candidate_mismatch');
  assert.equal((await store.getTask(task.id)).status, 'releasing');
});

integration('three repair cycles are allowed and further failure needs intervention', async (t) => {
  const store = await fixture(t);
  const task = await readyTask(store);
  let testing = await candidate(store, task.id);
  for (let failure = 0; failure < 4; failure += 1) {
    const updated = await store.finishJob(testing.job.id, testing.token, {
      summary: 'Reload check failed', passed: false, bugs: [defect],
      artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' },
    });
    assert.equal(updated.repair_count, Math.min(failure + 1, 3));
    if (failure === 3) {
      assert.equal(updated.status, 'needs_attention');
      assert.equal(await store.claimJob('developer'), null);
    } else {
      assert.equal(updated.status, 'repairing');
      const repair = await store.claimJob('developer');
      assert.equal(repair.task.bugs.filter((bug) => bug.status === 'open').length, failure + 1);
      await store.finishJob(repair.job.id, repair.token, {
        summary: 'Defect addressed', artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' },
      });
      testing = await store.claimJob('tester');
    }
  }
  assert.equal((await store.getTask(task.id)).bugs.length, 4);
});

integration('a concrete QA verification gap stops safely and retries testing without a repair loop', async t => {
  const store = await fixture(t);
  const task = await readyTask(store);
  const initial = await candidate(store, task.id);
  await store.finishJob(initial.job.id, initial.token, {
    summary: 'A product defect was reproduced', passed: false, bugs: [defect],
    artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' },
  });
  const repair = await store.claimJob('developer');
  await store.finishJob(repair.job.id, repair.token, {
    summary: 'Defect addressed', artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' },
  });
  const testing = await store.claimJob('tester');
  const before = await store.getTask(task.id);
  const result = { summary: 'Browser verification is blocked', passed: false, bugs: [], artifact: {
    commit: 'commit-a', image_digest: 'sha256:image-a', checks: [
      { name: 'build', passed: true, detail: 'Completed' },
      { name: 'Browser language scenario', passed: false, detail: 'Chromium exited with SIGTRAP before opening a page.' },
    ],
  } };
  for (const checks of [[], [{ name: 'browser', passed: true, detail: 'Complete' }],
    [{ name: ' ', passed: false, detail: 'Unavailable' }], [{ name: 'browser', passed: false, detail: '\n' }]]) {
    await assert.rejects(store.finishJob(testing.job.id, testing.token, { ...result, artifact: { ...result.artifact, checks } }), { status: 400 });
    assert.deepEqual(await store.getTask(task.id), before);
  }
  await assert.rejects(store.finishJob(testing.job.id, testing.token, { ...result, passed: true }), { status: 400 });
  assert.deepEqual(await store.getTask(task.id), before);
  const blocked = await store.finishJob(testing.job.id, testing.token, result);
  assert.equal(blocked.status, 'needs_attention');
  assert.equal(blocked.repair_count, 1);
  assert.deepEqual(blocked.artifact.developer, before.artifact.developer);
  assert.equal(blocked.artifact.tester.passed, false);
  assert.equal(blocked.artifact.tester.verification_blocked, true);
  assert.deepEqual(blocked.bugs, before.bugs);
  assert.equal(blocked.jobs.filter(job => ['pending', 'running'].includes(job.status)).length, 0);
  assert.equal(blocked.runs.at(-1).status, 'succeeded');
  assert.deepEqual(blocked.runs.at(-1).result, result);
  assert.equal(await store.claimJob('unexpected-auto-repair'), null);
  await assert.rejects(store.action(task.id, 'release'), { status: 409 });
  const resumed = await store.action(task.id, 'retry');
  assert.equal(resumed.status, 'testing');
  assert.equal(resumed.repair_count, 1);
  const repeated = await store.claimJob('verification-retry');
  assert.equal(repeated.job.role, 'tester');
  await store.finishJob(repeated.job.id, repeated.token, {
    summary: 'All required evidence is now available', passed: true, bugs: [],
    artifact: { commit: 'commit-a', image_digest: 'sha256:image-a', checks: [{ name: 'browser', passed: true, detail: 'Scenario verified' }] },
  });
  const passed = await store.getTask(task.id);
  assert.equal(passed.status, 'ready_release');
  assert.equal(passed.artifact.tester.verification_blocked, false);
  assert.equal(passed.bugs[0].status, 'closed');
});

integration('pause revokes the current execution and resume starts a fresh one', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Paused task' });
  await store.action(task.id, 'analyze');
  const first = await store.claimJob('worker');
  await store.action(task.id, 'pause');
  await assert.rejects(store.heartbeat(first.job.id, first.token), staleLease);
  await assert.rejects(store.finishJob(first.job.id, first.token, analysis), staleLease);
  assert.equal(await store.claimJob('worker'), null);
  await store.action(task.id, 'resume');
  const second = await store.claimJob('worker');
  assert.notEqual(second.token, first.token);
  await store.finishJob(second.job.id, second.token, analysis);
  assert.equal((await store.getTask(task.id)).status, 'ready');
});

integration('cancellation fences late completion and prevents resume', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Cancelled task' });
  await store.action(task.id, 'analyze');
  const first = await store.claimJob('worker');
  await store.action(task.id, 'cancel');
  await assert.rejects(store.finishJob(first.job.id, first.token, analysis), staleLease);
  await assert.rejects(store.action(task.id, 'resume'), (error) => error.status === 409);
  assert.equal((await store.getTask(task.id)).status, 'cancelled');
});

integration('requirements changes invalidate leases while priority changes preserve them', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Mutable task' });
  await store.action(task.id, 'analyze');
  const first = await store.claimJob('worker');
  const reprioritized = await store.updateTask(task.id, { priority: 'P0' });
  assert.equal(reprioritized.requirements_version, 1);
  await store.heartbeat(first.job.id, first.token);
  const edited = await store.updateTask(task.id, { description: 'New requirements' });
  assert.equal(edited.status, 'inbox');
  assert.equal(edited.requirements_version, 2);
  await assert.rejects(store.finishJob(first.job.id, first.token, analysis), staleLease);
  assert.equal(await store.claimJob('worker'), null);
});

integration('expired leases are recovered and old workers cannot finish the replacement', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Recovered task' });
  await store.action(task.id, 'analyze');
  const first = await store.claimJob('old-worker');
  await store.pool.query(`UPDATE "${store.schema}".jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [first.job.id]);
  await assert.rejects(store.heartbeat(first.job.id, first.token), staleLease);
  assert.equal((await store.recoverExpired()).length, 1);
  const second = await store.claimJob('new-worker');
  assert.equal(second.job.id, first.job.id);
  assert.notEqual(second.token, first.token);
  assert.equal(second.job.attempts, 2);
  await assert.rejects(store.finishJob(first.job.id, first.token, analysis), staleLease);
  await store.finishJob(second.job.id, second.token, analysis);
  assert.equal((await store.getTask(task.id)).runs[0].status, 'expired');
});

integration('infrastructure retries are bounded and do not consume repair cycles', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Temporary infrastructure failure' });
  await store.action(task.id, 'analyze');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claimed = await store.claimJob('worker');
    const failed = await store.failJob(claimed.job.id, claimed.token, 'Provider unavailable', { retryable: true });
    assert.equal(failed.repair_count, 0);
    assert.equal(failed.status, attempt < 3 ? 'analyzing' : 'needs_attention');
    await store.failJob(claimed.job.id, claimed.token, 'Provider unavailable', { retryable: true });
  }
  assert.equal(await store.claimJob('worker'), null);
  const detail = await store.getTask(task.id);
  assert.equal(detail.runs.length, 3);
  assert.equal(detail.events.filter((event) => event.type === 'job_failed').length, 3);
});

integration('quota and authentication waits preserve the task without exhausting failure attempts', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Wait for a subscription limit reset' });
  await store.action(task.id, 'analyze');
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const claimed = await store.claimJob('worker');
    assert.equal(claimed.job.attempts, 1);
    assert.equal(claimed.run.attempt, attempt);
    const waiting = await store.deferJob(claimed.job.id, claimed.token, attempt % 2 ? 'Subscription quota exhausted' : 'Authentication expired', { delayMs: 60_000 });
    assert.equal(waiting.status, 'analyzing');
    assert.equal(waiting.repair_count, 0);
    const pending = waiting.jobs.find((job) => job.id === claimed.job.id);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.attempts, 0);
    assert.equal(pending.lease_expires_at, null);
    assert.ok(new Date(pending.available_at).getTime() > Date.now() + 50_000);
    assert.equal(await store.claimJob('worker'), null);
    await store.deferJob(claimed.job.id, claimed.token, 'Duplicate callback', { delayMs: 1 });
    const duplicate = await store.getTask(task.id);
    assert.equal(duplicate.events.filter((event) => event.type === 'job_waiting').length, attempt);
    assert.equal(duplicate.jobs.find((job) => job.id === claimed.job.id).attempts, 0);
    await assert.rejects(store.finishJob(claimed.job.id, claimed.token, analysis), staleLease);
    await store.pool.query(`UPDATE "${store.schema}".jobs SET available_at = clock_timestamp() WHERE id = $1`, [claimed.job.id]);
  }
  const resumed = await store.claimJob('worker');
  assert.equal(resumed.run.attempt, 5);
  await store.finishJob(resumed.job.id, resumed.token, analysis);
  const detail = await store.getTask(task.id);
  assert.equal(detail.status, 'ready');
  assert.equal(detail.runs.filter((run) => run.status === 'failed').length, 4);
  assert.equal(detail.events.filter((event) => event.type === 'job_waiting').length, 4);
  assert.equal(detail.events.filter((event) => event.type === 'job_failed').length, 0);
});

integration('ordinary failures still exhaust their budget after deferred attempts', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Separate waiting and failure counters' });
  await store.action(task.id, 'analyze');
  const quotaWait = await store.claimJob('worker');
  await store.deferJob(quotaWait.job.id, quotaWait.token, 'Quota exhausted', { delayMs: 1 });
  await store.pool.query(`UPDATE "${store.schema}".jobs SET available_at = clock_timestamp() WHERE id = $1`, [quotaWait.job.id]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claimed = await store.claimJob('worker');
    assert.equal(claimed.job.attempts, attempt);
    assert.equal(claimed.run.attempt, attempt + 1);
    const failed = await store.failJob(claimed.job.id, claimed.token, 'Execution crashed', { retryable: true });
    assert.equal(failed.status, attempt < 3 ? 'analyzing' : 'needs_attention');
  }
  assert.equal(await store.claimJob('worker'), null);
});

integration('deferral rejects revoked leases, expired leases and obsolete requirements', async (t) => {
  const store = await fixture(t);
  for (const invalidation of ['cancel', 'expire', 'edit']) {
    const task = await store.createTask({ title: `Fenced wait ${invalidation}` });
    await store.action(task.id, 'analyze');
    const claimed = await store.claimJob('worker');
    if (invalidation === 'cancel') await store.action(task.id, 'cancel');
    if (invalidation === 'expire') await store.pool.query(`UPDATE "${store.schema}".jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [claimed.job.id]);
    if (invalidation === 'edit') await store.updateTask(task.id, { description: 'A different requirement' });
    await assert.rejects(store.deferJob(claimed.job.id, claimed.token, 'Authentication expired', { delayMs: 1000 }), staleLease);
    assert.equal((await store.getTask(task.id)).events.filter((event) => event.type === 'job_waiting').length, 0);
  }
});

integration('deferral validates its delay and allows waiting for up to one day', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Validated wait interval' });
  await store.action(task.id, 'analyze');
  const claimed = await store.claimJob('worker');
  for (const delayMs of [0, -1, 1.5, 86_400_001, '1000']) {
    await assert.rejects(store.deferJob(claimed.job.id, claimed.token, 'Quota exhausted', { delayMs }), (error) => error.status === 400);
  }
  assert.equal((await store.getTask(task.id)).runs[0].status, 'running');
  const waiting = await store.deferJob(claimed.job.id, claimed.token, 'Quota exhausted', { delayMs: 86_400_000 });
  assert.equal(waiting.status, 'analyzing');
  assert.ok(new Date(waiting.jobs[0].available_at).getTime() > Date.now() + 86_390_000);
});

integration('an interrupted release requires intervention instead of a blind retry', async (t) => {
  const store = await fixture(t);
  const task = await readyTask(store);
  const testing = await candidate(store, task.id);
  await store.finishJob(testing.job.id, testing.token, {
    summary: 'Passed', passed: true, bugs: [], artifact: { commit: 'commit-a', image_digest: 'sha256:image-a' },
  });
  await store.action(task.id, 'release');
  const release = await store.claimJob('release');
  await store.pool.query(`UPDATE "${store.schema}".jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [release.job.id]);
  await store.recoverExpired();
  assert.equal((await store.getTask(task.id)).status, 'needs_attention');
  assert.equal(await store.claimJob('release'), null);
});

integration('runtime authentication expires after a missing worker heartbeat', async (t) => {
  const store = await fixture(t);
  assert.equal((await store.getRuntime()).authenticated, false);
  const runtime = await store.setRuntime({ authenticated: true, available: true, worker_status: 'idle', mode: 'live' });
  assert.equal(runtime.stale, false);
  assert.equal((await store.getRuntime()).authenticated, true);
  await store.pool.query(`UPDATE "${store.schema}".settings SET value = value || jsonb_build_object('updated_at', clock_timestamp() - interval '61 seconds') WHERE key = '_runtime'`);
  const expired = await store.getRuntime();
  assert.equal(expired.stale, true);
  assert.equal(expired.authenticated, false);
  assert.equal(expired.available, false);
  assert.equal(expired.worker_status, 'offline');
  assert.equal((await store.updateSettings({ login_request: randomUUID() })).auto_develop, false);
});

integration('unsupported transitions and malformed reports do not modify durable state', async (t) => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Validated task' });
  await assert.rejects(store.action(task.id, 'release'), (error) => error.status === 409);
  await assert.rejects(store.updateTask(task.id, { status: 'done' }), (error) => error.status === 400);
  await assert.rejects(store.action(task.id, 'start'), (error) => error.status === 409);
  await store.action(task.id, 'analyze');
  const run = await store.claimJob('worker');
  await assert.rejects(store.finishJob(run.job.id, run.token, {
    summary: 'Incomplete', spec: { acceptance: [] }, questions: [],
  }), (error) => error.status === 400);
  const detail = await store.getTask(task.id);
  assert.equal(detail.status, 'analyzing');
  assert.equal(detail.runs[0].status, 'running');
  assert.equal(detail.events.filter((event) => event.type === 'job_completed').length, 0);
});
