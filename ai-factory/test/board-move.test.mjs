import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, StoreError } from '../lib/store.mjs';

const enabled = Boolean(process.env.PG_URL) || (process.env.NODE_ENV === 'test' && process.env.PGDATABASE === 'royal_test');
const integration = (name, callback) => test(name, { skip: !enabled }, callback);

async function fixture(t) {
  const schema = `factory_board_${randomUUID().replaceAll('-', '')}`;
  const store = new Store({ connectionString: process.env.PG_URL || undefined, schema });
  await store.init();
  t.after(async () => {
    await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await store.close();
  });
  return store;
}

const analysis = { summary: 'Acceptance prepared', spec: { acceptance: ['The feature works'] }, questions: [] };
const boardMove = (column_id, expected_status, before_task_id = null) => ({ column_id, expected_status, before_task_id });
const conflict = code => error => error instanceof StoreError && error.status === 409 && error.code === code;
const order = (tasks, column) => tasks.filter(task => task.board_column === column)
  .sort((a, b) => a.board_position - b.board_position).map(task => task.id);

async function claimRole(store, executorRole) {
  const task = await store.createTask({ title: `Recover ${executorRole}` });
  await store.action(task.id, 'analyze');
  let claim = await store.claimJob(`worker-${executorRole}`);
  if (executorRole !== 'analyst') {
    await store.finishJob(claim.job.id, claim.token, analysis);
    await store.action(task.id, 'start');
    claim = await store.claimJob(`worker-${executorRole}`);
  }
  if (['tester', 'release'].includes(executorRole)) {
    await store.finishJob(claim.job.id, claim.token, { summary: 'Candidate', artifact: { commit: 'recovery-candidate' } });
    claim = await store.claimJob(`worker-${executorRole}`);
  }
  if (executorRole === 'release') {
    await store.finishJob(claim.job.id, claim.token, { summary: 'Passed', passed: true, bugs: [], artifact: { commit: 'recovery-candidate' } });
    await store.action(task.id, 'release');
    claim = await store.claimJob(`worker-${executorRole}`);
  }
  return { task, claim };
}

integration('board ordering persists across store initialization without changing priorities or queue scheduling', async t => {
  const store = await fixture(t);
  const high = await store.createTask({ title: 'High priority', priority: 'P0' });
  const low = await store.createTask({ title: 'Low priority', priority: 'P3' });
  const middle = await store.createTask({ title: 'Middle priority', priority: 'P2' });
  const moved = await store.moveTask(low.id, boardMove('inbox', 'inbox', high.id));
  assert.equal(moved.board_position, 0);
  assert.deepEqual(moved.board_moves, ['inbox', 'analysis']);
  assert.deepEqual(order(await store.listTasks(), 'inbox'), [low.id, high.id, middle.id]);
  await store.init();
  assert.deepEqual(order(await store.listTasks(), 'inbox'), [low.id, high.id, middle.id]);
  await store.moveTask(high.id, boardMove('inbox', 'inbox'));
  assert.deepEqual(order(await store.listTasks(), 'inbox'), [low.id, middle.id, high.id]);
  assert.equal((await store.getTask(high.id)).priority, 'P0');
  assert.equal((await store.getTask(low.id)).priority, 'P3');
  for (const task of [low, high]) await store.action(task.id, 'analyze');
  assert.equal((await store.claimJob('priority-worker')).task.id, high.id);
});

integration('board transitions use normal analysis and development jobs and preserve QA handoff', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Move through the workflow' });
  const analyzing = await store.moveTask(task.id, boardMove('analysis', 'inbox'));
  assert.equal(analyzing.status, 'analyzing');
  assert.equal(analyzing.jobs.length, 1);
  assert.equal(analyzing.jobs[0].role, 'analyst');
  assert.deepEqual(analyzing.board_moves, ['analysis']);
  const claim = await store.claimJob('analyst');
  const ready = await store.finishJob(claim.job.id, claim.token, analysis);
  assert.deepEqual(ready.board_moves, ['ready', 'working']);
  const developing = await store.moveTask(task.id, boardMove('working', 'ready'));
  assert.equal(developing.status, 'developing');
  assert.equal(developing.jobs.at(-1).role, 'developer');
  const developer = await store.claimJob('developer');
  const testing = await store.finishJob(developer.job.id, developer.token, { summary: 'Candidate prepared', artifact: { commit: 'candidate-a' } });
  assert.equal(testing.status, 'testing');
  assert.equal(testing.jobs.at(-1).role, 'tester');
  assert.deepEqual(testing.board_moves, ['testing']);
  assert.equal(testing.board_column, 'working');
});

integration('active tasks can be reordered but a drop cannot revoke pending or running work', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Active task' });
  await store.action(task.id, 'analyze');
  const pending = await store.getTask(task.id);
  await assert.rejects(store.moveTask(task.id, boardMove('working', 'analyzing')), conflict('active_job'));
  assert.deepEqual(await store.getTask(task.id), pending);
  const claim = await store.claimJob('active-worker');
  await store.moveTask(task.id, boardMove('analysis', 'analyzing'));
  const running = await store.getTask(task.id);
  assert.equal(running.active_run.id, claim.run.id);
  assert.equal(running.jobs.at(-1).status, 'running');
  await assert.rejects(store.moveTask(task.id, boardMove('attention', 'analyzing')), conflict('active_job'));
  await store.finishJob(claim.job.id, claim.token, analysis);
  assert.equal((await store.getTask(task.id)).status, 'ready');
});

integration('drops cannot bypass questions, analysis, testing, release or cancellation', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Guarded workflow' });
  for (const target of ['ready', 'working', 'testing', 'release', 'done', 'attention']) {
    await assert.rejects(store.moveTask(task.id, boardMove(target, 'inbox')), conflict('invalid_transition'));
  }
  assert.equal((await store.getTask(task.id)).jobs.length, 0);
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('questions-worker');
  await store.finishJob(claim.job.id, claim.token, { ...analysis, questions: ['Which option?'] });
  await assert.rejects(store.moveTask(task.id, boardMove('working', 'needs_answers')), error => {
    assert.match(error.message, /ответь на вопросы/);
    return conflict('invalid_transition')(error);
  });
  await store.action(task.id, 'pause');
  const resumed = await store.moveTask(task.id, boardMove('analysis', 'paused'), { requireRuntime: true });
  assert.equal(resumed.status, 'needs_answers');
  assert.equal(resumed.questions.filter(question => question.status === 'open').length, 1);
  assert.equal(resumed.jobs.filter(job => ['pending', 'running'].includes(job.status)).length, 0);
  await store.action(task.id, 'cancel');
  const cancelled = await store.moveTask(task.id, boardMove('attention', 'cancelled'));
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.board_moves, ['attention']);
});

integration('attention drops restart only the failed role and expose the actual failure on the board', async t => {
  for (const [executorRole, column, status] of [['analyst', 'analysis', 'analyzing'], ['developer', 'working', 'developing'], ['tester', 'testing', 'testing']]) {
    const store = await fixture(t);
    const { task, claim } = await claimRole(store, executorRole);
    await store.failJob(claim.job.id, claim.token, `${executorRole} unavailable`);
    const detail = await store.getTask(task.id);
    const listed = (await store.listTasks()).find(item => item.id === task.id);
    assert.deepEqual(detail.board_moves, ['attention', column]);
    assert.deepEqual(detail.board_move_actions, { [column]: 'retry' });
    assert.deepEqual(detail.board_last_failure, { role: executorRole, error: `${executorRole} unavailable` });
    for (const key of ['board_moves', 'board_move_actions', 'board_last_failure']) assert.deepEqual(listed[key], detail[key]);
    assert.equal(Object.hasOwn(listed, 'board_latest_run'), false);
    assert.equal(Object.hasOwn(listed, 'board_latest_job'), false);
    assert.equal(Object.hasOwn(listed, 'board_release_enabled'), false);
    for (const wrongColumn of ['analysis', 'working', 'testing', 'release', 'done'].filter(value => value !== column)) {
      await assert.rejects(store.moveTask(task.id, boardMove(wrongColumn, 'needs_attention')), conflict('invalid_transition'));
    }
    const moved = await store.moveTask(task.id, boardMove(column, 'needs_attention'));
    assert.equal(moved.status, status);
    assert.equal(moved.jobs.at(-1).role, executorRole);
    assert.equal(moved.jobs.at(-1).requirements_version, detail.requirements_version);
    assert.deepEqual(moved.artifact, detail.artifact);
    assert.equal(moved.events.filter(event => event.type === 'task_action').at(-1).details.action, 'retry');
    await assert.rejects(store.finishJob(claim.job.id, claim.token, analysis), conflict('stale_lease'));
  }
});

integration('retry after exhausted QA repairs returns to development and retains open defect evidence', async t => {
  const store = await fixture(t);
  const { task, claim } = await claimRole(store, 'tester');
  await store.pool.query(`UPDATE "${store.schema}".tasks SET repair_count = 3 WHERE id = $1`, [task.id]);
  const blocked = await store.finishJob(claim.job.id, claim.token, { summary: 'Still broken', passed: false, artifact: { commit: 'recovery-candidate' }, bugs: [{
    title: 'Reload loses selection', expected: 'Selection retained', actual: 'Selection lost', steps: ['Reload'], severity: 'high',
  }] });
  assert.equal(blocked.status, 'needs_attention');
  assert.deepEqual(blocked.board_moves, ['attention', 'working']);
  assert.deepEqual((await store.listTasks()).find(item => item.id === task.id).board_moves, blocked.board_moves);
  await assert.rejects(store.moveTask(task.id, boardMove('release', 'needs_attention')), conflict('invalid_transition'));
  const resumed = await store.moveTask(task.id, boardMove('working', 'needs_attention'));
  assert.equal(resumed.status, 'developing');
  assert.equal(resumed.repair_count, 0);
  assert.equal(resumed.bugs[0].status, 'open');
  assert.deepEqual(resumed.artifact, blocked.artifact);
  assert.equal(resumed.jobs.at(-1).role, 'developer');
});

integration('paused active stages resume through the original role and revoke old leases', async t => {
  for (const [executorRole, column, status] of [['analyst', 'analysis', 'analyzing'], ['developer', 'working', 'developing'], ['tester', 'testing', 'testing']]) {
    const store = await fixture(t);
    const { task, claim } = await claimRole(store, executorRole);
    const paused = await store.action(task.id, 'pause');
    assert.deepEqual(paused.board_moves, ['attention', column]);
    assert.deepEqual(paused.board_move_actions, { [column]: 'resume' });
    const resumed = await store.moveTask(task.id, boardMove(column, 'paused'));
    assert.equal(resumed.status, status);
    assert.equal(resumed.jobs.at(-1).role, executorRole);
    assert.equal(resumed.resume_status, null);
    await assert.rejects(store.finishJob(claim.job.id, claim.token, analysis), conflict('stale_lease'));
  }
});

integration('recovery drops require a live worker only when an executor will be queued', async t => {
  const store = await fixture(t);
  const { task, claim } = await claimRole(store, 'analyst');
  await store.failJob(claim.job.id, claim.token, 'Offline');
  const blocked = await store.getTask(task.id);
  await assert.rejects(store.moveTask(task.id, boardMove('analysis', 'needs_attention'), { requireRuntime: true }), conflict('runtime_unavailable'));
  await assert.rejects(store.action(task.id, 'retry', { requireRuntime: true }), conflict('runtime_unavailable'));
  assert.deepEqual(await store.getTask(task.id), blocked);
  await store.setRuntime({ authenticated: true, available: true });
  const resumed = await store.moveTask(task.id, boardMove('analysis', 'needs_attention'), { requireRuntime: true });
  assert.equal(resumed.status, 'analyzing');
  await store.action(task.id, 'pause');
  await store.setRuntime({ authenticated: false, available: false });
  const paused = await store.getTask(task.id);
  await assert.rejects(store.moveTask(task.id, boardMove('analysis', 'paused'), { requireRuntime: true }), conflict('runtime_unavailable'));
  await assert.rejects(store.action(task.id, 'resume', { requireRuntime: true }), conflict('runtime_unavailable'));
  assert.deepEqual(await store.getTask(task.id), paused);
  const idle = await store.createTask({ title: 'Paused inbox' });
  await store.action(idle.id, 'pause');
  const restored = await store.moveTask(idle.id, boardMove('inbox', 'paused'), { requireRuntime: true });
  assert.equal(restored.status, 'inbox');
  assert.equal(restored.jobs.length, 0);
  await store.action(idle.id, 'pause');
  const restoredAction = await store.action(idle.id, 'resume', { requireRuntime: true });
  assert.equal(restoredAction.status, 'inbox');
  assert.equal(restoredAction.jobs.length, 0);
});

integration('guarded analysis and development actions fence runtime availability without changing legacy store calls', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Guarded action workflow' });
  await assert.rejects(store.action(task.id, 'analyze', { requireRuntime: true }), conflict('runtime_unavailable'));
  assert.equal((await store.getTask(task.id)).jobs.length, 0);
  await store.action(task.id, 'analyze');
  const analyst = await store.claimJob('legacy-analyst');
  await store.finishJob(analyst.job.id, analyst.token, analysis);
  await assert.rejects(store.action(task.id, 'start', { requireRuntime: true }), conflict('runtime_unavailable'));
  assert.equal((await store.getTask(task.id)).status, 'ready');
  await store.setRuntime({ authenticated: true, available: true });
  const started = await store.action(task.id, 'start', { requireRuntime: true });
  assert.equal(started.status, 'developing');
  assert.equal(started.jobs.at(-1).role, 'developer');
});

integration('disabled publication cannot be restarted by retry or drag while paused candidates remain restorable', async t => {
  const store = await fixture(t);
  const { task, claim } = await claimRole(store, 'release');
  await store.failJob(claim.job.id, claim.token, 'Release interrupted');
  await store.setRuntime({ authenticated: true, available: true, release_enabled: false });
  const blocked = await store.getTask(task.id);
  assert.deepEqual(blocked.board_moves, ['attention']);
  assert.deepEqual(blocked.board_move_actions, {});
  assert.match(blocked.board_blocked_reason, /публикации/);
  assert.equal((await store.listTasks()).find(item => item.id === task.id).board_blocked_reason, blocked.board_blocked_reason);
  await assert.rejects(store.action(task.id, 'retry'), conflict('release_disabled'));
  await assert.rejects(store.moveTask(task.id, boardMove('release', 'needs_attention')), conflict('release_disabled'));
  assert.deepEqual(await store.getTask(task.id), blocked);
  await store.pool.query(`UPDATE "${store.schema}".tasks SET status = 'paused', resume_status = 'releasing' WHERE id = $1`, [task.id]);
  await store.setRuntime({ authenticated: false, available: false });
  const restored = await store.moveTask(task.id, boardMove('release', 'paused'), { requireRuntime: true });
  assert.equal(restored.status, 'ready_release');
  assert.equal(restored.jobs.filter(job => ['pending', 'running'].includes(job.status)).length, 0);
  await assert.rejects(store.action(task.id, 'release'), conflict('release_disabled'));
});

integration('attention recovery cannot replace an active lease or release a candidate without current QA evidence', async t => {
  const store = await fixture(t);
  const active = await claimRole(store, 'analyst');
  await store.pool.query(`UPDATE "${store.schema}".tasks SET status = 'needs_attention' WHERE id = $1`, [active.task.id]);
  const before = await store.getTask(active.task.id);
  assert.deepEqual(before.board_moves, ['attention']);
  await assert.rejects(store.action(active.task.id, 'retry'), conflict('active_job'));
  await assert.rejects(store.moveTask(active.task.id, boardMove('analysis', 'needs_attention')), conflict('active_job'));
  assert.deepEqual(await store.getTask(active.task.id), before);
  await store.action(active.task.id, 'cancel');
  const release = await claimRole(store, 'release');
  await store.failJob(release.claim.job.id, release.claim.token, 'Interrupted');
  await store.setRuntime({ release_enabled: true });
  await store.pool.query(`UPDATE "${store.schema}".tasks SET artifact = jsonb_set(artifact, '{requirements_version}', '0') WHERE id = $1`, [release.task.id]);
  const obsolete = await store.getTask(release.task.id);
  await assert.rejects(store.action(release.task.id, 'retry'), conflict('qa_required'));
  await assert.rejects(store.moveTask(release.task.id, boardMove('release', 'needs_attention')), conflict('qa_required'));
  assert.deepEqual(await store.getTask(release.task.id), obsolete);
});

integration('concurrent recovery drops queue one new attempt and stale positioning rolls back recovery', async t => {
  const store = await fixture(t);
  const { task, claim } = await claimRole(store, 'analyst');
  await store.failJob(claim.job.id, claim.token, 'Interrupted');
  const wrongTarget = await store.createTask({ title: 'Wrong lane target' });
  const before = await store.getTask(task.id);
  await assert.rejects(store.moveTask(task.id, boardMove('analysis', 'needs_attention', wrongTarget.id)), conflict('stale_position'));
  assert.deepEqual(await store.getTask(task.id), before);
  const results = await Promise.allSettled([
    store.moveTask(task.id, boardMove('analysis', 'needs_attention')),
    store.moveTask(task.id, boardMove('analysis', 'needs_attention')),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'stale_status').length, 1);
  const after = await store.getTask(task.id);
  assert.equal(after.jobs.length, before.jobs.length + 1);
  assert.equal(after.jobs.filter(job => ['pending', 'running'].includes(job.status)).length, 1);
});

integration('stale status and stale target positions roll back both board changes and queued jobs', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Moving task' });
  const wrongColumn = await store.createTask({ title: 'Old target' });
  const before = await store.getTask(task.id);
  await assert.rejects(store.moveTask(task.id, boardMove('analysis', 'inbox', wrongColumn.id)), conflict('stale_position'));
  assert.deepEqual(await store.getTask(task.id), before);
  await store.action(task.id, 'analyze');
  const queued = await store.getTask(task.id);
  await assert.rejects(store.moveTask(task.id, boardMove('analysis', 'inbox')), conflict('stale_status'));
  assert.deepEqual(await store.getTask(task.id), queued);
  await assert.rejects(store.moveTask(task.id, { column_id: 'analysis' }), { status: 400 });
  await assert.rejects(store.moveTask(task.id, boardMove('analysis', 'analyzing', task.id)), { status: 400 });
  await assert.rejects(store.moveTask(task.id, { ...boardMove('analysis', 'analyzing'), priority: 'P0' }), { status: 400 });
});

integration('concurrent drops serialize and stale transition retries do not create duplicate jobs', async t => {
  const store = await fixture(t);
  const task = await store.createTask({ title: 'Concurrent transition' });
  const results = await Promise.allSettled([
    store.moveTask(task.id, boardMove('analysis', 'inbox')),
    store.moveTask(task.id, boardMove('analysis', 'inbox')),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'stale_status').length, 1);
  assert.equal((await store.getTask(task.id)).jobs.length, 1);
  const a = await store.createTask({ title: 'A' });
  const b = await store.createTask({ title: 'B' });
  const c = await store.createTask({ title: 'C' });
  await Promise.all([
    store.moveTask(c.id, boardMove('inbox', 'inbox', a.id)),
    store.moveTask(b.id, boardMove('inbox', 'inbox', a.id)),
  ]);
  const ordered = (await store.listTasks()).filter(item => item.status === 'inbox');
  assert.equal(new Set(ordered.map(item => item.board_position)).size, 3);
  assert.deepEqual(ordered.map(item => item.board_position).sort(), [0, 1, 2]);
});

test('a board reorder and a concurrent parent change complete without opposing task and foreign-key locks', { skip: !enabled, timeout: 8000 }, async t => {
  const store = await fixture(t);
  const child = await store.createTask({ title: 'Child edited concurrently' });
  const parent = await store.createTask({ title: 'Parent moved concurrently' });
  const boardLocked = Promise.withResolvers();
  const childLocked = Promise.withResolvers();
  const proceed = Promise.withResolvers();
  const originalTask = store._task.bind(store);
  store._task = async (client, taskId, lock) => {
    const result = await originalTask(client, taskId, lock);
    if (taskId === parent.id && lock) {
      boardLocked.resolve();
      await proceed.promise;
    } else if (taskId === child.id && lock) {
      childLocked.resolve();
      await proceed.promise;
    }
    return result;
  };
  t.after(() => { proceed.resolve(); store._task = originalTask; });
  const move = store.moveTask(parent.id, boardMove('inbox', 'inbox', child.id));
  await boardLocked.promise;
  const edit = store.updateTask(child.id, { parent_id: parent.id });
  await childLocked.promise;
  proceed.resolve();
  const [moved, edited] = await Promise.all([move, edit]);
  assert.equal(moved.board_position, 0);
  assert.equal(edited.parent_id, parent.id);
  assert.equal((await store.getTask(child.id)).parent_id, parent.id);
  assert.deepEqual(order(await store.listTasks(), 'inbox'), [parent.id, child.id]);
});
