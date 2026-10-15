import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, link, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { canonical, createGraphEvent, graphContext, graphDigest, materializeGraph,
  mergeGraphEvents, readGraphJournal, reconcileEquivalentGraphHeads, selectGraph, updateGraphRecords, writeGraphJournal } from '../lib/knowledge-graph.mjs';
import { Store, memoryText } from '../lib/store.mjs';
import { installGraphKnowledge } from '../lib/project-knowledge.mjs';

const stamp = '2026-10-10T00:00:00.000Z';
const proof = [{ path: 'docs/gateway.md', sha256: 'a'.repeat(64) }];
const isolatedEnvironment = process.env.NODE_ENV === 'test' && process.env.PGDATABASE === 'royal_test'
  && ['127.0.0.1', 'localhost'].includes(process.env.PGHOST);
let isolatedUrl = false;
try {
  const parsed = new URL(process.env.PG_URL || '');
  isolatedUrl = process.env.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    && parsed.pathname === '/royal_test';
} catch { /* A missing URL uses the isolated wrapper environment. */ }
const enabled = process.env.PG_URL ? isolatedUrl : isolatedEnvironment;
const integration = (name, callback) => test(name, { skip: !enabled }, callback);
const entity = (id = 'service:gateway', summary = 'Confirmed internal gateway', extra = {}) => ({
  kind: 'entity', id, name: id, entity_type: 'service', summary,
  status: 'verified', environment: 'production', evidence: proof, ...extra,
});
const relation = (id, source, target, text = 'Confirmed gateway connection', extra = {}) => ({
  kind: 'relation', id, source, target, predicate: 'uses', text,
  status: 'verified', environment: 'production', evidence: proof, ...extra,
});
const event = (record, options = {}) => createGraphEvent(record, { created_at: stamp, ...options });
const execute = promisify(execFile);

test('graph merge preserves divergent branches without selecting one and is idempotent across order', () => {
  const base = event(entity(), { origin: 'curated' });
  const left = event(entity(undefined, 'First proposed update'), { parent: base.id });
  const right = event(entity(undefined, 'Different proposed update'), { parent: base.id });
  const merged = mergeGraphEvents([right, base], [left, base], [left]);
  const snapshot = materializeGraph(merged);
  assert.equal(merged.length, 3);
  assert.equal(snapshot.nodes.length, 0);
  assert.deepEqual(snapshot.conflicts, [{ record_id: base.record_id, event_ids: [left.id, right.id].sort() }]);
  assert.equal(materializeGraph(mergeGraphEvents([left, right, base], merged)).hash, snapshot.hash);
  const refreshed = updateGraphRecords(merged, [entity()], { origin: 'curated', created_at: stamp });
  assert.equal(refreshed.length, 3);
  assert.deepEqual(materializeGraph(refreshed).conflicts, snapshot.conflicts);
});

test('content hashes ignore object key order while rejecting tampering and missing or mismatched parents', () => {
  assert.equal(canonical({ z: { b: 2, a: 1 }, a: ['x', 'y'] }), canonical({ a: ['x', 'y'], z: { a: 1, b: 2 } }));
  assert.equal(graphDigest({ b: 2, a: 1 }), graphDigest({ a: 1, b: 2 }));
  const base = event(entity());
  assert.throws(() => mergeGraphEvents([{ ...base, record: { ...base.record, summary: 'Altered after signing' } }]), /fingerprint mismatch/);
  assert.throws(() => mergeGraphEvents([event(entity(), { parent: 'b'.repeat(64) })]), /missing or mismatched parent/);
  const other = event(entity('service:other'));
  assert.throws(() => mergeGraphEvents([other, event(entity(), { parent: other.id })]), /missing or mismatched parent/);
});

test('equivalent curated branches reconcile deterministically while preserving every prior version', () => {
  const older = event(entity(undefined, 'Earlier source wording'), { origin: 'curated' });
  const revised = event(entity(), { parent: older.id, origin: 'curated', created_at: '2026-10-10T00:00:01.000Z' });
  const fresh = event(entity(), { origin: 'curated', created_at: '2026-10-10T00:00:02.000Z' });
  assert.equal(materializeGraph([older, revised, fresh]).conflicts.length, 1);
  const reconciled = reconcileEquivalentGraphHeads([fresh, older, revised]);
  const snapshot = materializeGraph(reconciled);
  assert.equal(snapshot.events.length, 4);
  assert.equal(snapshot.conflicts.length, 0);
  assert.equal(snapshot.nodes[0].summary, fresh.record.summary);
  const joined = snapshot.events.find(item => item.id === snapshot.nodes[0].event_id);
  assert.deepEqual(joined.parent, [fresh.id, revised.id].sort());
  assert.equal(joined.origin, 'curated');
  assert.equal(joined.created_at, '2026-10-10T00:00:02.001Z');
  assert.deepEqual(reconcileEquivalentGraphHeads([revised, fresh, older]), reconciled);
  assert.deepEqual(reconcileEquivalentGraphHeads(reconciled), reconciled);
});

test('equivalent reconciliation keeps content, state, evidence, provenance and deletion differences conflicted', () => {
  const left = event(entity(), { origin: 'curated' });
  const variants = [
    event(entity(undefined, 'Different source wording'), { origin: 'curated' }),
    event(entity(undefined, undefined, { status: 'planned' }), { origin: 'curated' }),
    event(entity(undefined, undefined, { environment: 'sandbox' }), { origin: 'curated' }),
    event(entity(undefined, undefined, { evidence: [{ ...proof[0], sha256: 'b'.repeat(64) }] }), { origin: 'curated' }),
    event(entity(), { origin: 'local' }),
    createGraphEvent(null, { record_id: left.record_id, deleted: true, origin: 'curated', created_at: stamp }),
  ];
  for (const right of variants) {
    const reconciled = reconcileEquivalentGraphHeads([left, right]);
    assert.equal(reconciled.length, 2);
    assert.equal(materializeGraph(reconciled).conflicts.length, 1);
    assert.equal(materializeGraph(reconciled).nodes.length, 0);
  }
});

test('equivalent tombstone branches join without recreating the deleted fact', () => {
  const first = event(entity(), { origin: 'curated' });
  const second = event(entity(), { origin: 'curated', created_at: '2026-10-10T00:00:01.000Z' });
  const deleted = [first, second].map((parent, index) => createGraphEvent(null, {
    record_id: parent.record_id, parent: parent.id, deleted: true, origin: 'curated',
    created_at: `2026-10-10T00:00:0${index + 2}.000Z`,
  }));
  const snapshot = materializeGraph(reconcileEquivalentGraphHeads([first, second, ...deleted]));
  assert.equal(snapshot.events.length, 5);
  assert.equal(snapshot.conflicts.length, 0);
  assert.equal(snapshot.nodes.length, 0);
  const joined = snapshot.events.find(item => Array.isArray(item.parent));
  assert.equal(joined.deleted, true);
  assert.equal(joined.record, null);
  assert.deepEqual(joined.parent, deleted.map(item => item.id).sort());
});

test('automatic refresh preserves explicit local overrides and local tombstones of curated facts', () => {
  const base = event(entity(), { origin: 'curated' });
  const override = event(entity(undefined, 'Owner approved correction'), { parent: base.id, origin: 'local' });
  const refreshed = updateGraphRecords([base, override], [entity(undefined, 'New curated source wording')], {
    origin: 'curated', created_at: '2026-10-10T00:00:02.000Z', removeIds: [base.record_id],
  });
  assert.equal(refreshed.length, 2);
  assert.equal(materializeGraph(refreshed).nodes[0].summary, override.record.summary);
  const deleted = createGraphEvent(null, { record_id: base.record_id, parent: override.id,
    deleted: true, origin: 'local', created_at: '2026-10-10T00:00:03.000Z' });
  const afterDeletion = updateGraphRecords([...refreshed, deleted], [entity()], { origin: 'curated' });
  assert.equal(afterDeletion.length, 3);
  assert.equal(materializeGraph(afterDeletion).nodes.length, 0);
});

test('an explicit merge consumes both conflicting heads and keeps all prior evidence', () => {
  const base = event(entity());
  const left = event(entity(undefined, 'First update'), { parent: base.id });
  const right = event(entity(undefined, 'Other update'), { parent: base.id });
  const resolution = event(entity(undefined, 'Human approved combined result'), { parent: [left.id, right.id] });
  const snapshot = materializeGraph([base, left, right, resolution]);
  assert.equal(snapshot.conflicts.length, 0);
  assert.equal(snapshot.nodes.length, 1);
  assert.equal(snapshot.nodes[0].summary, 'Human approved combined result');
  assert.equal(snapshot.events.length, 4);
  assert.throws(() => mergeGraphEvents([base, left, resolution]), /missing or mismatched parent/);
});

test('deletion keeps history, hides dangling relations and allows explicit recreation', () => {
  const source = event(entity());
  const target = event(entity('service:api'));
  const edge = event(relation('edge:gateway_api', source.record_id, target.record_id));
  const deleted = createGraphEvent(null, { record_id: target.record_id, parent: target.id, deleted: true,
    origin: 'local', created_at: '2026-10-10T00:00:01.000Z' });
  const history = mergeGraphEvents([source, target, edge, deleted]);
  const snapshot = materializeGraph(history);
  assert.deepEqual(snapshot.nodes.map(node => node.id), [source.record_id]);
  assert.equal(snapshot.edges.length, 0);
  assert.equal(snapshot.events.length, 4);
  const recreated = updateGraphRecords(history, [entity('service:api')], { origin: 'local', created_at: '2026-10-10T00:00:02.000Z' });
  const next = materializeGraph(recreated);
  assert.equal(next.nodes.length, 2);
  assert.equal(next.edges.length, 1);
  assert.equal(next.events.length, 5);
  assert.equal(next.events.find(item => item.id === next.nodes.find(node => node.id === target.record_id).event_id).parent, deleted.id);
});

test('graph search finds evidence through relationships and retains candidate boundaries', () => {
  const candidate = entity('integration:mainnet', 'Prepared USDT adapter, not published', { status: 'candidate', environment: 'candidate' });
  const snapshot = materializeGraph([event(entity()), event(candidate),
    event(relation('edge:gateway_candidate', 'service:gateway', candidate.id, 'Gateway is linked to prepared USDT mainnet', { status: 'candidate', environment: 'candidate' }))]);
  const result = graphContext(snapshot, 'USDT mainnet');
  assert.deepEqual(result.nodes.map(node => node.id).sort(), ['integration:mainnet', 'service:gateway']);
  assert.equal(result.nodes.find(node => node.id === candidate.id).status, 'candidate');
  assert.equal(result.nodes.find(node => node.id === candidate.id).environment, 'candidate');
  assert.match(result.instructions, /Candidate is not production/);
  assert.equal(result.sha256, snapshot.hash);
});

test('bounded selection never reintroduces the excluded task or its scoped decisions through edges', () => {
  const taskId = randomUUID();
  const task = entity(`task:${taskId}`, 'gateway requirement', { entity_type: 'task', status: 'planned', environment: 'project' });
  const decision = entity(`decision:${taskId}:choice`, 'gateway human decision', { entity_type: 'decision', status: 'decision', environment: 'project' });
  const snapshot = materializeGraph([event(entity()), event(entity('service:api')), event(task), event(decision),
    event(relation('edge:task_gateway', task.id, 'service:gateway', 'gateway task proof')),
    event(relation('edge:task_decision', task.id, decision.id, 'gateway human decision')),
    event(relation('edge:gateway_api', 'service:gateway', 'service:api', 'gateway endpoint'))]);
  const selected = selectGraph(snapshot, 'gateway', { excludeTaskId: taskId, limit: 3 });
  assert.equal(selected.nodes.some(node => node.id === task.id || node.id === decision.id), false);
  assert.equal(selected.edges.some(edge => [edge.source, edge.target].some(id => id === task.id || id === decision.id)), false);
  assert.ok(selectGraph(snapshot, 'gateway', { excludeTaskId: taskId, limit: 1 }).nodes.length <= 1);
});

async function files(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'royal-graph-journal-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, 'nested', 'journal.json') };
}

test('journal persistence replaces complete valid snapshots and preserves prior data after invalid input', async t => {
  const { path } = await files(t);
  const base = event(entity());
  await writeGraphJournal(path, [base]);
  const bytes = await readFile(path, 'utf8');
  assert.equal(materializeGraph(await readGraphJournal(path)).hash, materializeGraph([base]).hash);
  const update = event(entity(undefined, 'New confirmed gateway'), { parent: base.id });
  const pending = writeGraphJournal(path, [base, update]);
  const observed = JSON.parse(await readFile(path, 'utf8'));
  assert.ok([1, 2].includes(observed.events.length));
  await pending;
  assert.equal((await readGraphJournal(path)).length, 2);
  const complete = await readFile(path, 'utf8');
  await assert.rejects(writeGraphJournal(path, [{ ...update, id: 'a'.repeat(64) }]), /fingerprint mismatch/);
  assert.equal(await readFile(path, 'utf8'), complete);
  assert.notEqual(complete, bytes);
});

test('journal writes reject linked parent directories and clean failed temporary writes', async t => {
  const { directory } = await files(t);
  const real = join(directory, 'real');
  const linked = join(directory, 'linked');
  await mkdir(real);
  await symlink(real, linked);
  await assert.rejects(writeGraphJournal(join(linked, 'journal.json'), [event(entity())]));
  assert.deepEqual(await readdir(real), []);
  const blocked = join(directory, 'blocked.json');
  await mkdir(blocked);
  await writeFile(join(blocked, 'keep'), 'unchanged');
  await assert.rejects(writeGraphJournal(blocked, [event(entity())]));
  assert.equal(await readFile(join(blocked, 'keep'), 'utf8'), 'unchanged');
  assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp')), false);
});

test('managed graph fixture pins verified events and rejects foreign links or a substituted fingerprint', async t => {
  const { directory } = await files(t);
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  const candidate = join(workspace, 'app.js');
  await writeFile(candidate, 'Existing application candidate');
  const snapshot = materializeGraph([event(entity())]);
  const path = await installGraphKnowledge(workspace, snapshot);
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(fixture.hash, snapshot.hash);
  assert.equal(Object.hasOwn(fixture, 'events'), false);
  assert.equal((await lstat(path)).mode & 0o777, 0o444);
  assert.equal(await readFile(candidate, 'utf8'), 'Existing application candidate');
  await assert.rejects(installGraphKnowledge(workspace, { ...snapshot, hash: 'b'.repeat(64) }), /fingerprint mismatch/);
  const foreign = join(directory, 'foreign.json');
  await writeFile(foreign, 'Foreign original');
  await rm(path);
  await symlink(foreign, path);
  await assert.rejects(installGraphKnowledge(workspace, snapshot), /managed knowledge fixture/);
  await rm(path);
  await link(foreign, path);
  await assert.rejects(installGraphKnowledge(workspace, snapshot), /managed knowledge fixture/);
  assert.equal(await readFile(foreign, 'utf8'), 'Foreign original');
  await rm(path);
  await rm(join(workspace, '.factory'), { recursive: true });
  await symlink(directory, join(workspace, '.factory'));
  await assert.rejects(installGraphKnowledge(workspace, snapshot), /managed knowledge directory/);
  assert.equal(await readFile(candidate, 'utf8'), 'Existing application candidate');
});

test('managed graph refresh cannot overwrite tracked candidate files or alter its commit', async t => {
  const { directory } = await files(t);
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  const fallback = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/git');
  let gitBinary = 'git';
  try { await access(fallback); gitBinary = fallback; } catch {}
  await execute(gitBinary, ['init', workspace]);
  await execute(gitBinary, ['-C', workspace, 'config', 'user.name', 'Graph Fixture']);
  await execute(gitBinary, ['-C', workspace, 'config', 'user.email', 'fixture@example.invalid']);
  await mkdir(join(workspace, '.factory'));
  const target = join(workspace, '.factory', 'knowledge-graph.json');
  await writeFile(target, 'Tracked evidence must stay intact');
  await writeFile(join(workspace, 'app.js'), 'Tracked application candidate');
  await execute(gitBinary, ['-C', workspace, 'add', '.']);
  await execute(gitBinary, ['-C', workspace, 'commit', '-m', 'Graph candidate fixture']);
  const before = (await execute(gitBinary, ['-C', workspace, 'rev-parse', 'HEAD'])).stdout;
  const snapshot = materializeGraph([event(entity())]);
  await assert.rejects(installGraphKnowledge(workspace, snapshot, { gitBinary }), /must not be tracked/);
  assert.equal(await readFile(target, 'utf8'), 'Tracked evidence must stay intact');
  assert.equal((await execute(gitBinary, ['-C', workspace, 'diff', '--name-only'])).stdout.trim(), '');
  assert.equal((await execute(gitBinary, ['-C', workspace, 'rev-parse', 'HEAD'])).stdout, before);
});

async function storeFixture(t, options = {}) {
  const schema = `factory_graph_${randomUUID().replaceAll('-', '')}`;
  const pool = options.singleConnection ? new pg.Pool({ connectionString: process.env.PG_URL || undefined, max: 1 }) : undefined;
  const store = new Store({ connectionString: process.env.PG_URL || undefined, schema, ...(pool ? { pool } : {}) });
  await store.init();
  t.after(async () => {
    await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await store.close();
    if (pool) await pool.end();
  });
  return store;
}

async function readyTask(store, title) {
  const task = await store.createTask({ title });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('graph-analyst');
  await store.finishJob(claim.job.id, claim.token, { summary: 'Requirements prepared',
    spec: { acceptance: ['Observed balance is correct'], subtasks: [] }, questions: [] });
  return task;
}

async function testedCandidate(store, task, commit, pass = true) {
  await store.action(task.id, 'start');
  const developer = await store.claimJob('graph-developer');
  await store.finishJob(developer.job.id, developer.token, { summary: 'Implemented isolated candidate', artifact: { commit } });
  const tester = await store.claimJob('graph-tester');
  await store.finishJob(tester.job.id, tester.token, { summary: pass ? 'Independent QA passed' : 'Could not complete checks',
    passed: pass, bugs: [], artifact: { commit, ...(pass ? {} : { checks: [{ name: 'Browser verification', passed: false, detail: 'Browser runner unavailable' }] }) } });
  return task;
}

integration('graph refresh automatically archives all human answers and tombstones cancelled decisions', async t => {
  const store = await storeFixture(t);
  const task = await store.createTask({ title: 'Gateway decisions' });
  await store.action(task.id, 'analyze');
  const analyst = await store.claimJob('graph-analyst');
  const waiting = await store.finishJob(analyst.job.id, analyst.token, { summary: 'Human choices required',
    spec: { acceptance: [], subtasks: [] }, questions: Array.from({ length: 25 }, (_, index) => `Gateway choice ${index}`) });
  const questions = waiting.questions.map(question => question.id);
  await store.answerQuestions(task.id, Object.fromEntries(questions.map((id, index) => [id, `Confirmed human answer ${index}`])));
  const first = await store.knowledgeGraph();
  assert.ok(first.nodes.some(node => node.id === 'service:finance_gateway'));
  assert.equal(first.nodes.filter(node => node.id.startsWith(`decision:${task.id}:`)).length, 25);
  assert.equal((await store.knowledgeGraph()).hash, first.hash);
  await store.action(task.id, 'cancel');
  const cancelled = await store.knowledgeGraph();
  assert.equal(cancelled.nodes.some(node => node.id.startsWith(`decision:${task.id}:`)), false);
  assert.equal(cancelled.edges.some(edge => edge.predicate === 'decides' && edge.source === `task:${task.id}`), false);
  assert.ok(cancelled.events.some(item => item.record_id === `decision:${task.id}:${questions[0]}` && item.deleted));
  assert.ok(cancelled.events.length > first.events.length);
});

integration('long UTF-8 analyst questions keep bounded graph names without blocking other task contexts', async t => {
  const store = await storeFixture(t);
  const task = await store.createTask({ title: 'Уточнение игрового баланса' });
  const question = `Баланс ${'я'.repeat(246)}`;
  assert.equal(Buffer.byteLength(question), 505);
  assert.throws(() => event(entity(undefined, undefined, { name: question })), /invalid or sensitive text/);
  assert.throws(() => event(entity(undefined, undefined, { name: 'Bearer credential123' })), /invalid or sensitive text/);
  await store.action(task.id, 'analyze');
  const analyst = await store.claimJob('graph-long-question');
  const waiting = await store.finishJob(analyst.job.id, analyst.token, { summary: 'Нужно решение владельца',
    spec: { acceptance: [], subtasks: [] }, questions: [question] });
  const questionId = waiting.questions[0].id;
  const answer = 'Использовать общий игровой баланс.';
  await store.answerQuestions(task.id, { [questionId]: answer });

  const snapshot = await store.knowledgeGraph();
  const decision = snapshot.nodes.find(node => node.id === `decision:${task.id}:${questionId}`);
  assert.ok(decision);
  assert.equal(decision.name, memoryText(question, 500));
  assert.ok(Buffer.byteLength(decision.name) <= 500);
  assert.equal(Buffer.from(decision.name).toString('utf8'), decision.name);
  assert.equal(decision.summary, answer);
  const savedQuestion = (await store.getTask(task.id)).questions.find(item => item.id === questionId);
  assert.equal(savedQuestion.text, question);
  assert.equal(decision.evidence[0].sha256, graphDigest({ question: memoryText(question, 900),
    answer: memoryText(answer, 2600), answered_at: new Date(savedQuestion.answered_at).toISOString() }));

  const other = await store.createTask({ title: 'Восстановление соединения и баланса' });
  const refreshed = await store.knowledgeGraph();
  const context = graphContext(refreshed, 'баланс', { excludeTaskId: other.id });
  assert.ok(context.nodes.some(node => node.id === decision.id));
  assert.equal(context.nodes.some(node => node.id === `task:${other.id}`), false);
});

integration('graph candidate facts require successful matching QA and release remains a distinct boundary', async t => {
  const store = await storeFixture(t);
  const approved = await testedCandidate(store, await readyTask(store, 'Passing candidate'), 'a'.repeat(40));
  const blocked = await testedCandidate(store, await readyTask(store, 'Blocked candidate'), 'b'.repeat(40), false);
  const first = await store.knowledgeGraph();
  const id = `candidate:${approved.id}:${'a'.repeat(40)}`;
  assert.equal(first.nodes.find(node => node.id === id).status, 'candidate');
  assert.equal(first.nodes.find(node => node.id === id).environment, 'candidate');
  assert.equal(first.nodes.some(node => node.id.startsWith(`candidate:${blocked.id}:`)), false);
  await store.action(approved.id, 'release');
  const release = await store.claimJob('graph-release');
  await store.finishJob(release.job.id, release.token, { summary: 'Publication independently confirmed', artifact: { commit: 'a'.repeat(40) } });
  const next = await store.knowledgeGraph();
  assert.equal(next.nodes.find(node => node.id === id).status, 'verified');
  assert.equal(next.nodes.find(node => node.id === id).environment, 'production');
  await store.updateTask(approved.id, { description: 'New requirements invalidate the older candidate proof' });
  const revised = await store.knowledgeGraph();
  assert.equal(revised.nodes.some(node => node.id === id), false);
  assert.ok(revised.events.some(item => item.record_id === id && item.deleted));
});

integration('graph exchange deduplicates signed events, preserves conflicts and rejects invalid imports atomically', async t => {
  const store = await storeFixture(t);
  const base = event(entity('service:remote'));
  const left = event(entity('service:remote', 'First remote update'), { parent: base.id });
  const right = event(entity('service:remote', 'Second remote update'), { parent: base.id });
  const first = await store.exchangeKnowledgeGraph([base, left]);
  const repeat = await store.exchangeKnowledgeGraph([left, base]);
  assert.equal(repeat.hash, first.hash);
  const conflicted = await store.exchangeKnowledgeGraph([right, base]);
  assert.ok(conflicted.conflicts.some(conflict => conflict.record_id === base.record_id));
  assert.equal(conflicted.nodes.some(node => node.id === base.record_id), false);
  await assert.rejects(store.exchangeKnowledgeGraph([event(entity('service:missing'), { parent: 'c'.repeat(64) })]), /missing or mismatched parent/);
  await assert.rejects(store.exchangeKnowledgeGraph([{ ...right, record: { ...right.record, summary: 'Tampered import' } }]), /fingerprint mismatch/);
  const after = await store.knowledgeGraph();
  assert.equal(after.hash, conflicted.hash);
  assert.equal(after.events.length, conflicted.events.length);
});

integration('graph exchange preserves local curated corrections and rejects forged factory facts as a whole batch', async t => {
  const store = await storeFixture(t);
  await store.createTask({ title: 'Managed task retained during graph round trip' });
  const initial = await store.knowledgeGraph();
  assert.ok(initial.events.some(item => item.origin === 'factory'));
  const base = initial.events.find(item => item.record_id === 'service:finance_gateway');
  const correction = event({ ...base.record, summary: 'Owner approved local gateway correction' }, {
    parent: base.id, origin: 'local', created_at: '2026-10-10T23:00:00.000Z',
  });
  const corrected = await store.exchangeKnowledgeGraph([correction]);
  assert.equal(corrected.nodes.find(node => node.id === base.record_id).summary, correction.record.summary);
  const refreshed = await store.knowledgeGraph();
  assert.equal(refreshed.hash, corrected.hash);
  const roundTrip = await store.exchangeKnowledgeGraph(refreshed.events);
  assert.equal(roundTrip.hash, refreshed.hash);

  const forged = [
    event(entity('service:forged_factory'), { origin: 'factory' }),
    ...['task', 'decision', 'candidate', 'decision-link', 'candidate-link'].map(prefix =>
      event(entity(`${prefix}:forged_record`), { origin: 'local' })),
  ];
  for (const [index, spoof] of forged.entries()) {
    const valid = event(entity(`service:rollback_${index}`));
    await assert.rejects(store.exchangeKnowledgeGraph([valid, spoof]), error =>
      error.status === 400 && /Factory facts can only be produced by the server/.test(error.message));
    const after = await store.knowledgeGraph();
    assert.equal(after.hash, refreshed.hash);
    assert.equal(after.events.length, refreshed.events.length);
    assert.equal(after.events.some(item => item.id === valid.id || item.id === spoof.id), false);
  }
});

integration('graph exchange joins equivalent curated histories once and retains genuine later conflicts', async t => {
  const store = await storeFixture(t);
  const initial = await store.knowledgeGraph();
  const base = initial.events.find(item => item.record_id === 'service:finance_gateway');
  const equivalentRoot = event(base.record, { origin: 'curated', created_at: '2026-10-09T00:00:00.000Z' });
  const exchanged = await store.exchangeKnowledgeGraph([equivalentRoot]);
  assert.equal(exchanged.conflicts.length, 0);
  assert.equal(exchanged.events.length, initial.events.length + 2);
  const gateway = exchanged.nodes.find(item => item.id === base.record_id);
  const joined = exchanged.events.find(item => item.id === gateway.event_id);
  assert.deepEqual(joined.parent, [base.id, equivalentRoot.id].sort());
  assert.equal(joined.created_at, new Date(Date.parse(base.created_at) + 1).toISOString());
  const repeated = await store.exchangeKnowledgeGraph([equivalentRoot, base]);
  assert.equal(repeated.hash, exchanged.hash);
  assert.equal((await store.knowledgeGraph()).hash, exchanged.hash);

  const genuineChange = event({ ...base.record, summary: 'Owner correction with a different meaning' }, {
    origin: 'local', parent: base.id, created_at: '2026-10-10T23:00:00.000Z',
  });
  const conflicted = await store.exchangeKnowledgeGraph([genuineChange]);
  assert.ok(conflicted.conflicts.some(item => item.record_id === base.record_id));
  assert.equal(conflicted.nodes.some(item => item.id === base.record_id), false);
  assert.equal((await store.exchangeKnowledgeGraph([genuineChange, equivalentRoot])).hash, conflicted.hash);
});

integration('graph refresh does not require extra connections while holding its transaction lock', async t => {
  const store = await storeFixture(t, { singleConnection: true });
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Graph refresh waited for its own occupied connection')), 2500);
    timer.unref();
  });
  const snapshot = await Promise.race([store.knowledgeGraph(), timeout]);
  assert.ok(snapshot.nodes.length > 0);
});

integration('run graph metadata is validated, immutable and retained with completed evidence', async t => {
  const store = await storeFixture(t);
  const task = await store.createTask({ title: 'Pinned graph run' });
  await store.action(task.id, 'analyze');
  const claim = await store.claimJob('graph-context');
  const knowledge_graph = { sha256: 'a'.repeat(64), node_count: 35, edge_count: 42, conflict_count: 0 };
  for (const invalid of [
    { ...knowledge_graph, sha256: 'invalid' },
    { ...knowledge_graph, node_count: -1 },
    { ...knowledge_graph, edge_count: 20001 },
    { ...knowledge_graph, conflict_count: 1.5 },
    { ...knowledge_graph, events: [] },
    { sha256: 'a'.repeat(64), node_count: 35, edge_count: 42 },
  ]) await assert.rejects(store.recordRunExecution(claim.job.id, claim.token, { knowledge_graph: invalid }), { status: 400 });
  const recorded = await store.recordRunExecution(claim.job.id, claim.token, { knowledge_graph });
  assert.deepEqual(recorded.knowledge_graph, knowledge_graph);
  assert.deepEqual((await store.recordRunExecution(claim.job.id, claim.token, { knowledge_graph })).knowledge_graph, knowledge_graph);
  for (const changed of [{ ...knowledge_graph, sha256: 'b'.repeat(64) }, { ...knowledge_graph, node_count: 36 }]) {
    await assert.rejects(store.recordRunExecution(claim.job.id, claim.token, { knowledge_graph: changed }), { status: 409, code: 'context_mismatch' });
  }
  await assert.rejects(store.recordRunExecution(claim.job.id, randomUUID(), { knowledge_graph }), { status: 409, code: 'stale_lease' });
  await store.finishJob(claim.job.id, claim.token, { summary: 'Knowledge used in analysis',
    spec: { acceptance: ['Existing gateway reused'], subtasks: [] }, questions: [] });
  assert.deepEqual((await store.getTask(task.id)).runs[0].execution.knowledge_graph, knowledge_graph);
});
