import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_NAMES, loadActiveSnapshot, publishSnapshot, readStatus, recordTarget } from '../scripts/shared-brain-store.mjs';
import { graphQueryEnvironment, handleSharedRequest as rawSharedRequest, validateSharedRequest } from '../scripts/shared-brain-reader.mjs';

const handleSharedRequest = (request, options) => rawSharedRequest(request, {
  verifyIdentity: async (path, value) => ({ runtimeFingerprint: value.runtimeFingerprint, checkScope: 'deployment-identity',
    checkedAt: '2026-11-03T12:00:00.000Z', lastProgramVerificationAt: '2026-11-03T10:00:00.000Z' }), ...options,
});

const output = fileURLToPath(new URL('../graphify-out/', import.meta.url));
const fingerprint = label => createHash('sha256').update(label).digest('hex');
const commit = 'a'.repeat(40), knowledgeCommit = 'b'.repeat(40);
function candidate(label, overrides = {}) {
  const production = { schemaVersion: 1, scope: 'production', runtimeFingerprint: fingerprint(label), releaseId: 'release-' + label,
    verifiedAt: '2026-11-03T10:00:00.000Z', components: [
      { id: 'host', scope: 'host', coverage: 'complete', sources: [{ path: 'src/main.ts', sha256: fingerprint(label), origin: { commit, patches: [] } }] },
      { id: 'knowledge', scope: 'knowledge', coverage: 'complete', sourceCommit: knowledgeCommit },
    ], ...overrides };
  const index = { schemaVersion: 1, provenance: { commit: 'local-release-marker', workingTreeModified: false }, knowledgeNeedingReview: 0,
    records: [{ id: 'wallet', kind: 'knowledge', key: 'knowledge:wallet', title: 'Кошелёк', source: 'docs/wallet.md',
      summary: 'Version ' + label, links: [] }] };
  return { production, artifacts: { 'graph.json': JSON.stringify({ directed: true, nodes: [{ id: 'wallet', label: 'Wallet ' + label }], links: [] }),
    'project-brain.json': JSON.stringify(index), 'PROJECT_BRAIN.md': '# Shared graph ' + label + '\n' },
  verifyRuntime: async () => production.runtimeFingerprint };
}
async function fixture(callback) {
  await mkdir(output, { recursive: true });
  const temporary = await realpath(await mkdtemp(join(output, 'shared-test-'))), root = join(temporary, 'store');
  try { await callback(root, temporary); } finally { await rm(temporary, { recursive: true, force: true }); }
}
async function inventory(root) {
  const entries = [];
  async function walk(path) {
    for (const name of (await readdir(path)).sort()) {
      const next = join(path, name), info = await lstat(next);
      if (info.isDirectory()) await walk(next);
      else entries.push([next, info.size, info.mtimeMs, await readFile(next, 'utf8')]);
    }
  }
  await walk(root); return entries;
}

test('atomic publication is idempotent, keeps current and previous, and supports a verified rollback', async () => fixture(async root => {
  const a = await publishSnapshot(root, candidate('a'));
  const b = await publishSnapshot(root, candidate('b'));
  const c = await publishSnapshot(root, candidate('c'));
  assert.deepEqual((await readStatus(root)).current, c.snapshotId);
  assert.equal((await readStatus(root)).previous, b.snapshotId);
  assert.deepEqual((await readdir(join(root, 'snapshots'))).sort(), [b.snapshotId, c.snapshotId].sort());
  const repeated = await publishSnapshot(root, candidate('c'));
  assert.equal(repeated.snapshotId, c.snapshotId);
  assert.equal(repeated.previousSnapshotId, b.snapshotId);
  const rollback = await publishSnapshot(root, candidate('a'));
  assert.equal(rollback.snapshotId, a.snapshotId);
  assert.equal(rollback.previousSnapshotId, c.snapshotId);
  assert.equal((await readStatus(root)).provenance.runtimeFingerprint, fingerprint('a'));
}));

test('a changed runtime rejects a prepared graph and removes its unpublished generation', async () => fixture(async root => {
  const before = await publishSnapshot(root, candidate('a'));
  let checks = 0;
  await assert.rejects(publishSnapshot(root, { ...candidate('b'), verifyRuntime: async () => ++checks === 1 ? fingerprint('b') : fingerprint('c') }),
    error => error.code === 'runtime_changed');
  assert.equal(checks, 2);
  assert.equal((await readStatus(root)).current, before.snapshotId);
  assert.deepEqual(await readdir(join(root, 'snapshots')), [before.snapshotId]);
}));

test('a latest verified receipt makes old queries fail closed before an index target exists', async () => fixture(async root => {
  await publishSnapshot(root, candidate('a'));
  await mkdir(join(root, 'receipts'));
  await writeFile(join(root, 'receipts/latest.json'), JSON.stringify({ runtimeFingerprint: fingerprint('b'), release: 'release-b' }));
  assert.equal((await readStatus(root)).state, 'pending');
  const response = await handleSharedRequest({ schemaVersion: 1, operation: 'brain', question: 'кошелёк' }, { storeRoot: root });
  assert.equal(response.exitCode, 2); assert.equal(response.envelope.ok, false);
  assert.equal(response.envelope.error.code, 'graph_pending');
  assert.equal(response.envelope.result.text, '');
  await recordTarget(root, { runtimeFingerprint: fingerprint('b'), releaseId: 'release-b', state: 'failed', errorCode: 'index_failed' });
  assert.equal((await readStatus(root)).state, 'failed');
  await assert.rejects(recordTarget(root, { runtimeFingerprint: fingerprint('c'), releaseId: 'release-c', state: 'pending' }), error => error.code === 'stale_target');
  await writeFile(join(root, 'receipts/latest.json'), JSON.stringify({ runtimeFingerprint: fingerprint('a'), releaseId: 'release-a' }));
  assert.equal((await readStatus(root)).state, 'ready');
  await recordTarget(root, { runtimeFingerprint: fingerprint('a'), releaseId: 'release-a', state: 'failed', errorCode: 'runtime_verification_failed' });
  assert.equal((await readStatus(root)).state, 'failed');
}));

test('read-only operations do not create state or mutate an installed snapshot', async () => fixture(async root => {
  assert.equal((await readStatus(root)).state, 'missing');
  await assert.rejects(access(root), { code: 'ENOENT' });
  await publishSnapshot(root, candidate('a'));
  const before = await inventory(root);
  const response = await handleSharedRequest({ schemaVersion: 1, operation: 'brain', question: 'кошелёк' }, { storeRoot: root });
  assert.equal(response.exitCode, 0);
  assert.match(response.envelope.result.text, /Общий граф production: выпуск release-a/);
  assert.ok(response.envelope.result.text.includes(knowledgeCommit));
  assert.doesNotMatch(response.envelope.result.text, /local-release-marker|Снимок репозитория/);
  assert.deepEqual(await inventory(root), before);
}));

test('missing status needs no publication verifier, while failed identity checks never report an existing graph as current', async () => fixture(async root => {
  let checks = 0;
  const unavailable = async () => { checks++; throw new Error('private system detail'); };
  const missing = await rawSharedRequest({ schemaVersion: 1, operation: 'status' }, { storeRoot: root, verifyIdentity: unavailable });
  assert.equal(missing.exitCode, 0); assert.equal(missing.envelope.result.state, 'missing'); assert.equal(checks, 0);
  await publishSnapshot(root, candidate('a'));
  for (const request of [{ schemaVersion: 1, operation: 'status' }, { schemaVersion: 1, operation: 'brain', question: 'кошелёк' }]) {
    const response = await rawSharedRequest(request, { storeRoot: root, verifyIdentity: unavailable });
    assert.equal(response.exitCode, 4); assert.equal(response.envelope.ok, false);
    assert.equal(response.envelope.provenance, null); assert.equal(response.envelope.result.state, 'unverified');
    assert.equal(response.envelope.error.code, 'publication_unverified');
    assert.doesNotMatch(JSON.stringify(response), /private system detail/);
  }
  assert.equal(checks, 2);
}));

test('publication identity is freshly checked before and after every status and graph answer', async () => fixture(async root => {
  await publishSnapshot(root, candidate('a'));
  for (const request of [{ schemaVersion: 1, operation: 'status' }, { schemaVersion: 1, operation: 'brain', question: 'кошелёк' }]) {
    let checks = 0;
    const response = await handleSharedRequest(request, { storeRoot: root, verifyIdentity: async (path, value) => {
      assert.equal(path, join(root, 'receipts', fingerprint('a') + '.json'));
      checks++;
      return { runtimeFingerprint: value.runtimeFingerprint, checkScope: 'deployment-identity',
        checkedAt: '2026-11-03T12:00:0' + checks + '.000Z', lastProgramVerificationAt: '2026-11-03T10:00:00.000Z' };
    } });
    assert.equal(response.exitCode, 0); assert.equal(checks, 2);
    assert.deepEqual(response.envelope.result.check, { scope: 'deployment-identity', checkedAt: '2026-11-03T12:00:02.000Z', lastProgramVerificationAt: '2026-11-03T10:00:00.000Z' });
    assert.match(response.envelope.result.text, /только идентификаторы выбранной публикации/);
    assert.match(response.envelope.result.text, /Сохранённая полная проверка файлов программы: 2026-11-03T10:00:00.000Z/);
  }
}));

test('a changed publication after the graph calculation discards its result and a wrong check scope fails closed', async () => fixture(async root => {
  await publishSnapshot(root, candidate('a'));
  let checks = 0, queries = 0;
  const response = await handleSharedRequest({ schemaVersion: 1, operation: 'query', question: 'wallet' }, { storeRoot: root,
    verifyIdentity: async (path, value) => { if (++checks === 2) throw new Error('publication changed');
      return { runtimeFingerprint: value.runtimeFingerprint, checkScope: 'deployment-identity',
        checkedAt: '2026-11-03T12:00:00.000Z', lastProgramVerificationAt: '2026-11-03T10:00:00.000Z' };
    }, runGraphify: async () => { queries++; return { exitCode: 0, text: 'discard this answer' }; } });
  assert.equal(checks, 2); assert.equal(queries, 1); assert.equal(response.exitCode, 4);
  assert.equal(response.envelope.error.code, 'publication_unverified'); assert.equal(response.envelope.result.text, '');
  const wrongScope = await handleSharedRequest({ schemaVersion: 1, operation: 'status' }, { storeRoot: root,
    verifyIdentity: async (path, value) => ({ runtimeFingerprint: value.runtimeFingerprint, checkScope: 'full-program',
      checkedAt: '2026-11-03T12:00:00.000Z', lastProgramVerificationAt: '2026-11-03T10:00:00.000Z' }) });
  assert.equal(wrongScope.exitCode, 4); assert.equal(wrongScope.envelope.error.code, 'publication_unverified');
}));

test('a new receipt during a running query prevents a stale production answer', async () => fixture(async root => {
  await publishSnapshot(root, candidate('a'));
  const response = await handleSharedRequest({ schemaVersion: 1, operation: 'query', question: 'wallet' }, { storeRoot: root,
    runGraphify: async (args, snapshot) => {
      assert.equal(snapshot.queryDirectory, root);
      await mkdir(join(root, 'receipts'));
      await writeFile(join(root, 'receipts/latest.json'), JSON.stringify({ runtimeFingerprint: fingerprint('b'), release: 'release-b' }));
      return { exitCode: 0, text: 'stale result must not escape' };
    } });
  assert.equal(response.exitCode, 4); assert.equal(response.envelope.error.code, 'graph_changed');
  assert.equal(response.envelope.provenance, null); assert.equal(response.envelope.result.text, '');
}));

test('the fixed reader entrypoint executes through the installed current symlink', async () => fixture(async (root, temporary) => {
  const current = join(temporary, 'current');
  await symlink(fileURLToPath(new URL('../', import.meta.url)), current);
  const result = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(current, 'scripts/shared-brain-reader.mjs')],
      { env: { ...process.env, ROYAL_BRAIN_STORE: root }, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '', stderr = '';
    child.stdout.on('data', chunk => { text += chunk.toString(); }); child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject); child.once('close', exitCode => accept({ text, stderr, exitCode }));
    child.stdin.end(JSON.stringify({ schemaVersion: 1, operation: 'status' }));
  });
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.text).result.state, 'missing');
  await assert.rejects(access(root), { code: 'ENOENT' });
}));

test('snapshot checksums, linked roots and unsupported artifact names are rejected', async () => fixture(async (root, temporary) => {
  const installed = await publishSnapshot(root, candidate('a'));
  await writeFile(join(root, 'snapshots', installed.snapshotId, 'graph.json'), candidate('a').artifacts['graph.json'] + ' ');
  await assert.rejects(loadActiveSnapshot(root), error => error.code === 'graph_integrity');
  const response = await handleSharedRequest({ schemaVersion: 1, operation: 'query', question: 'wallet' }, { storeRoot: root });
  assert.equal(response.envelope.ok, false);
  assert.equal(response.envelope.error.code, 'graph_integrity');
  const linked = join(temporary, 'linked'); await symlink(root, linked);
  await assert.rejects(readStatus(linked), error => error.code === 'unsafe_store');
  await assert.rejects(publishSnapshot(join(temporary, 'other'), { ...candidate('a'), artifacts: { ...candidate('a').artifacts, '../outside': 'bad' } }), error => error.code === 'invalid_snapshot');
  assert.deepEqual(ARTIFACT_NAMES, ['graph.json', 'project-brain.json', 'PROJECT_BRAIN.md', 'production.json']);
}));

test('a pinned reader retains the original graph inode while later publications retire its directory', async () => fixture(async root => {
  const a = await publishSnapshot(root, candidate('a'));
  const pinned = await loadActiveSnapshot(root);
  try {
    await publishSnapshot(root, candidate('b')); await publishSnapshot(root, candidate('c'));
    await assert.rejects(access(join(root, 'snapshots', a.snapshotId)), { code: 'ENOENT' });
    const bytes = Buffer.alloc(1024), result = await pinned.graphHandle.read(bytes, 0, bytes.length, 0);
    assert.equal(JSON.parse(bytes.subarray(0, result.bytesRead)).nodes[0].label, 'Wallet a');
    assert.equal(pinned.index.records[0].summary, 'Version a');
  } finally { await pinned.close(); }
}));

test('concurrent publication is serialized and readers continue using a complete old snapshot', async () => fixture(async root => {
  const a = await publishSnapshot(root, candidate('a'));
  let resume, started;
  const began = new Promise(accept => { started = accept; });
  const gate = new Promise(accept => { resume = accept; });
  let calls = 0;
  const publication = publishSnapshot(root, { ...candidate('b'), verifyRuntime: async () => { if (++calls === 1) { started(); await gate; } return fingerprint('b'); } });
  await began;
  assert.equal((await readStatus(root)).current, a.snapshotId);
  await assert.rejects(publishSnapshot(root, candidate('c')), error => error.code === 'store_locked');
  resume(); await publication;
  assert.equal((await readStatus(root)).provenance.releaseId, 'release-b');
}));

test('unsafe requests cannot choose files or commands and shell-looking questions remain plain data', async () => fixture(async root => {
  for (const request of [
    { operation: 'publish' }, { operation: 'query', question: '--graph' }, { operation: 'query', question: 'x', graph: '/private' },
    { operation: 'explain', subject: ' --help' }, { operation: 'status', args: ['extract', '.'] },
    { operation: 'affected', subject: 'Wallet', depth: 20 }, { operation: 'query', question: 'x', budget: 999999 },
    { operation: 'path', source: 'Wallet', target: 'DB', directed: 'false' }, { operation: 'query', question: 'x\n--graph /private' },
  ]) assert.throws(() => validateSharedRequest({ schemaVersion: 1, ...request }), error => error.code === 'invalid_request');
  await assert.rejects(access(root), { code: 'ENOENT' });
  await publishSnapshot(root, candidate('a'));
  let actual;
  const question = 'wallet $(touch /tmp/forbidden) "quoted"';
  const response = await handleSharedRequest({ schemaVersion: 1, operation: 'query', question, budget: 128 },
    { storeRoot: root, runGraphify: async args => { actual = args; return { text: 'Candidates', exitCode: 3 }; } });
  assert.equal(actual[1], question);
  assert.deepEqual(actual.slice(2, 4), ['--budget', '128']);
  assert.equal(actual[4], '--graph');
  assert.equal(response.exitCode, 3); assert.equal(response.envelope.error.code, 'ambiguous');
  const absent = await handleSharedRequest({ schemaVersion: 1, operation: 'explain', subject: 'missing' },
    { storeRoot: root, runGraphify: async () => ({ text: '', exitCode: 4 }) });
  assert.equal(absent.exitCode, 4); assert.equal(absent.envelope.error.code, 'not_found');
}));

test('partial and mixed components remain explicit and provider credentials are not passed to Graphify', async () => fixture(async root => {
  await publishSnapshot(root, candidate('mixed', { components: [
    { id: 'host', scope: 'host', coverage: 'partial', sources: [
      { path: 'src/a.ts', origin: { commit, patches: [] } }, { path: 'src/b.ts', origin: { commit: knowledgeCommit, patches: ['patch'] } },
    ] }, { id: 'knowledge', scope: 'knowledge', coverage: 'complete', sourceCommit: knowledgeCommit },
  ] }));
  const response = await handleSharedRequest({ schemaVersion: 1, operation: 'brain', question: 'кошелёк', clientCommit: 'c'.repeat(40) }, { storeRoot: root });
  assert.ok(response.envelope.warnings.some(item => item.code === 'partial_source_coverage'));
  assert.ok(response.envelope.warnings.some(item => item.code === 'mixed_source_provenance'));
  assert.ok(response.envelope.warnings.some(item => item.code === 'local_checkout_differs_from_production'));
  assert.equal(response.envelope.provenance.components[0].sourceCommits.length, 2);
  const env = graphQueryEnvironment({ PATH: '/bin', HOME: '/home/test', A6API_KEY: 'fixture', OPENAI_API_KEY: 'fixture', GRAPHIFY_BACKEND: 'openai', DATABASE_URL: 'fixture' });
  assert.equal(env.GRAPHIFY_BACKEND, 'none'); assert.equal(env.GRAPHIFY_QUERY_LOG_DISABLE, '1');
  for (const name of ['A6API_KEY', 'OPENAI_API_KEY', 'DATABASE_URL']) assert.equal(env[name], undefined);
}));
