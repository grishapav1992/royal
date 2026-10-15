import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { normalizeUsage } from '../lib/usage.mjs';

const enabled = Boolean(process.env.PG_URL) || (process.env.NODE_ENV === 'test' && process.env.PGDATABASE === 'royal_test');
const integration = (name, callback) => test(name, { skip: !enabled }, callback);

async function fixture(t) {
  const schema = `usage_test_${randomUUID().replaceAll('-', '')}`;
  const store = new Store({ connectionString: process.env.PG_URL || undefined, schema });
  await store.init();
  t.after(async () => {
    await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await store.close();
  });
  return store;
}

async function claimed(store, title = 'Measured task') {
  const task = await store.createTask({ title });
  await store.action(task.id, 'analyze');
  return store.claimJob('usage-test-worker');
}

const usage = { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 };
const full = { ...usage, total_tokens: 120 };
const unknown = { input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_output_tokens: null, total_tokens: null };

test('token usage keeps unknown subsets and never double counts cache or reasoning', () => {
  assert.deepEqual(normalizeUsage(usage), full);
  assert.deepEqual(normalizeUsage({ input_tokens: 10, output_tokens: 2 }), {
    input_tokens: 10, cached_input_tokens: null, output_tokens: 2, reasoning_output_tokens: null, total_tokens: 12,
  });
  assert.deepEqual(normalizeUsage({ input_tokens: 0 }), { ...unknown, input_tokens: 0 });
  for (const invalid of [null, [], {}, Object.create({ input_tokens: 10 }), { input_tokens: -1 }, { output_tokens: 1.5 },
    { input_tokens: '10' }, { input_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 },
    { input_tokens: 2, cached_input_tokens: 3 }, { output_tokens: 2, reasoning_output_tokens: 3 },
    { ...usage, total_tokens: 165 }, { input_tokens: 10, secret: 'hidden' },
    { input_tokens: 10, total_tokens: 10 }, { input_tokens: 10, output_tokens: 2, total_tokens: -1 }]) {
    assert.throws(() => normalizeUsage(invalid), TypeError);
  }
});

integration('usage is lease fenced, immutable, idempotent and publicly excludes lease credentials', async t => {
  const store = await fixture(t);
  const claim = await claimed(store);
  assert.equal(claim.run.usage, null);
  assert.deepEqual(await store.recordRunUsage(claim.job.id, claim.token, usage), full);
  assert.deepEqual(await store.recordRunUsage(claim.job.id, claim.token, full), full);
  await assert.rejects(store.recordRunUsage(claim.job.id, claim.token, { ...usage, output_tokens: 21 }), { status: 409, code: 'usage_mismatch' });
  await assert.rejects(store.recordRunUsage(claim.job.id, randomUUID(), usage), { status: 409, code: 'stale_lease' });
  const detail = await store.getTask(claim.task.id);
  assert.deepEqual(detail.runs[0].usage, full);
  assert.deepEqual(detail.active_run.usage, full);
  assert.equal(JSON.stringify(detail).includes(claim.token), false);
  assert.equal(detail.events.filter(event => event.type === 'agent_usage').length, 0);
  assert.deepEqual((await store.usageSummary()).totals, full);
  await store.failJob(claim.job.id, claim.token, 'Execution failed after reporting');
  await assert.rejects(store.recordRunUsage(claim.job.id, claim.token, full), { status: 409, code: 'stale_lease' });
  assert.equal((await store.usageSummary()).reported_runs, 1);
});

integration('usage cannot be written after pause, lease expiry or requirements change', async t => {
  for (const mode of ['pause', 'expiry', 'requirements']) {
    const store = await fixture(t);
    const claim = await claimed(store, mode);
    if (mode === 'pause') await store.action(claim.task.id, 'pause');
    if (mode === 'expiry') await store.pool.query(`UPDATE "${store.schema}".jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [claim.job.id]);
    if (mode === 'requirements') await store.pool.query(`UPDATE "${store.schema}".tasks SET requirements_version = requirements_version + 1 WHERE id = $1`, [claim.task.id]);
    await assert.rejects(store.recordRunUsage(claim.job.id, claim.token, usage), { status: 409, code: 'stale_lease' });
    assert.equal((await store.getTask(claim.task.id)).runs[0].usage, null);
  }
});

integration('usage migration is repeatable and historical executions remain unknown', async t => {
  const store = await fixture(t);
  const claim = await claimed(store);
  await store.pool.query(`ALTER TABLE "${store.schema}".runs DROP COLUMN usage`);
  await store.init();
  await store.init();
  assert.equal((await store.getTask(claim.task.id)).runs[0].usage, null);
  const summary = await store.usageSummary();
  assert.deepEqual(summary.totals, unknown);
  assert.equal(summary.reported_runs, 0);
  assert.equal(summary.unreported_runs, 1);
  assert.equal(summary.coverage_started_at, null);
});

integration('usage summary combines safe legacy reports across tasks and roles without inventing old run identities', async t => {
  const store = await fixture(t);
  const measured = await claimed(store, 'Measured');
  await store.recordRunUsage(measured.job.id, measured.token, usage);
  await store.failJob(measured.job.id, measured.token, 'Expected test failure');
  const missing = await claimed(store, 'No telemetry');
  await store.recordEvent(measured.task.id, 'agent_usage', { role: 'analyst', usage: { input_tokens: 11, output_tokens: 3 } });
  await store.recordEvent(missing.task.id, 'agent_usage', { role: 'tester', usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 4, reasoning_output_tokens: 1 } });
  await store.recordEvent(missing.task.id, 'agent_usage', { role: 'developer', usage: { input_tokens: 5 } });
  // A legacy report with a known new run identity is excluded to avoid a double count.
  await store.recordEvent(measured.task.id, 'agent_usage', { role: 'analyst', run_id: measured.run.id, usage });
  const summary = await store.usageSummary();
  assert.deepEqual(summary.totals, { input_tokens: 123, cached_input_tokens: 42, output_tokens: 27, reasoning_output_tokens: 6, total_tokens: 145 });
  assert.equal(summary.reported_runs, 1);
  assert.equal(summary.unreported_runs, 1);
  assert.equal(summary.legacy_reports, 3);
  assert.ok(summary.coverage_started_at);
  assert.deepEqual(summary.by_role.find(row => row.role === 'developer').totals, { ...unknown, input_tokens: 5 });
  assert.equal(summary.by_role.find(row => row.role === 'developer').legacy_reports, 1);
  assert.deepEqual((await store.usageSummary({ taskId: measured.task.id })).totals, { ...full, input_tokens: 111, output_tokens: 23, total_tokens: 134 });
  assert.equal((await store.usageSummary({ taskId: missing.task.id })).legacy_reports, 2);
  assert.deepEqual((await store.usageSummary({ taskId: randomUUID() })).totals, unknown);
  await assert.rejects(store.usageSummary({ taskId: 'invalid' }), { status: 400 });
});

integration('malformed historical reports are ignored and valid zero reports remain known', async t => {
  const store = await fixture(t);
  const claim = await claimed(store);
  for (const invalid of [null, [], {}, { input_tokens: '10' }, { input_tokens: -1 }, { input_tokens: 2.5 },
    { input_tokens: Number.MAX_SAFE_INTEGER + 1 }, { input_tokens: 2, cached_input_tokens: 3 },
    { output_tokens: 2, reasoning_output_tokens: 3 }, { ...usage, total_tokens: 165 },
    { input_tokens: 10, private_text: 'sensitive' }, { input_tokens: 10, output_tokens: 2, total_tokens: '12' }]) {
    await store.recordEvent(claim.task.id, 'agent_usage', { role: 'analyst', usage: invalid });
  }
  await store.recordEvent(claim.task.id, 'agent_usage', { role: 'unknown', usage });
  await store.recordEvent(claim.task.id, 'agent_usage', { role: 'release', usage: { input_tokens: 0, output_tokens: 0 } });
  const summary = await store.usageSummary();
  assert.deepEqual(summary.totals, { ...unknown, input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  assert.equal(summary.legacy_reports, 1);
  assert.equal(summary.unreported_runs, 1);
  assert.equal(summary.by_role.find(row => row.role === 'analyst').reported_runs, 0);
});

integration('failed and expired attempts retain reported usage and retries add distinct run counts', async t => {
  const store = await fixture(t);
  const first = await claimed(store);
  await store.recordRunUsage(first.job.id, first.token, { input_tokens: 10, output_tokens: 2 });
  await store.pool.query(`UPDATE "${store.schema}".jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [first.job.id]);
  await store.recoverExpired();
  const next = await store.claimJob('retry-usage-worker');
  await store.recordRunUsage(next.job.id, next.token, { input_tokens: 4 });
  await store.failJob(next.job.id, next.token, 'Failed retry');
  const detail = await store.getTask(first.task.id);
  assert.deepEqual(detail.runs.map(run => run.status), ['expired', 'failed']);
  const summary = await store.usageSummary();
  assert.equal(summary.reported_runs, 2);
  assert.equal(summary.unreported_runs, 0);
  assert.deepEqual(summary.totals, { ...unknown, input_tokens: 14, output_tokens: 2, total_tokens: 12 });
});

integration('usage summary never publishes rounded aggregates beyond safe integer precision', async t => {
  const store = await fixture(t);
  const claim = await claimed(store);
  await store.recordRunUsage(claim.job.id, claim.token, { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 });
  await store.recordEvent(claim.task.id, 'agent_usage', { role: 'analyst', usage: { input_tokens: 1, output_tokens: 0 } });
  const summary = await store.usageSummary();
  assert.equal(summary.totals.input_tokens, null);
  assert.equal(summary.totals.total_tokens, null);
  assert.equal(summary.totals.output_tokens, 0);
  assert.equal(summary.reported_runs, 1);
  assert.equal(summary.legacy_reports, 1);
});
