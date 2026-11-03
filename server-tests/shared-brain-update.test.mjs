import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { receiptFingerprint, updateProductionGraph } from '../scripts/shared-brain-update.mjs';
import { loadActiveSnapshot, readStatus } from '../scripts/shared-brain-store.mjs';

const output = fileURLToPath(new URL('../graphify-out/', import.meta.url));
const ownerUid = process.getuid(), hash = value => createHash('sha256').update(value).digest('hex');
const commit = value => hash(value).slice(0, 40);
const json = (path, value) => writeFile(path, JSON.stringify(value) + '\n', { mode: 0o600 });

async function install(program, label) {
  await mkdir(join(program, 'scripts'), { recursive: true, mode: 0o700 });
  const content = 'export const generation = ' + JSON.stringify(label) + ';\n';
  await writeFile(join(program, 'scripts/tool.mjs'), content, { mode: 0o600 });
  await json(join(program, 'install-receipt.json'), { schemaVersion: 1, githubVerified: true, sourceCommit: commit('tool-' + label),
    files: [{ path: 'scripts/tool.mjs', sha256: hash(content) }] });
}

async function receipt(root, label) {
  await mkdir(join(root, 'receipts'), { recursive: true, mode: 0o700 });
  const value = { schemaVersion: 1, verified: true, release: 'release-' + label, sourceCommit: commit(label),
    components: [{ id: 'host', kind: 'host', coverage: 'complete', sources: [{ path: 'src/wallet.ts', sha256: hash(label), origin: { commit: commit(label), path: 'src/wallet.ts', baseSha256: hash(label), patches: [] } }] }] };
  value.runtimeFingerprint = receiptFingerprint(value); value.collectedAt = '2026-11-03T12:00:00Z';
  await json(join(root, 'receipts', value.runtimeFingerprint + '.json'), value);
  await json(join(root, 'receipts/latest.json'), value);
  return value;
}

function built(value) {
  return { artifacts: { 'graph.json': JSON.stringify({ directed: true, nodes: [{ id: value.release, label: 'Wallet' }], links: [] }),
    'project-brain.json': JSON.stringify({ schemaVersion: 1, provenance: { commit: value.sourceCommit }, records: [] }), 'PROJECT_BRAIN.md': '# Production\n' },
  production: { schemaVersion: 1, scope: 'production', runtimeFingerprint: value.runtimeFingerprint,
    releaseId: value.release, verifiedAt: value.collectedAt, components: value.components.map(({ kind, ...component }) => ({ ...component, scope: kind })) } };
}

async function fixture(callback) {
  await mkdir(output, { recursive: true });
  const temporary = await realpath(await mkdtemp(join(output, 'shared-update-test-')));
  const root = join(temporary, 'store'), program = join(temporary, 'program');
  await mkdir(root, { mode: 0o700 }); await mkdir(program, { mode: 0o700 }); await install(program, 'a');
  const options = { storeRoot: root, programRoot: program, liveRoot: join(temporary, 'live'), ownerUid,
    builder: async value => built(value), verifyRuntime: async (path, value) => {
      assert.equal(path, join(root, 'receipts', value.runtimeFingerprint + '.json'));
      return { runtimeFingerprint: value.runtimeFingerprint };
    } };
  try { await callback({ root, program, temporary, options }); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}

test('receipt identity is stable across key order and collection time and includes UTF8 source text', () => {
  const a = { schemaVersion: 1, label: 'Рояль', nested: { b: 'two', a: 'one' }, collectedAt: 'earlier' };
  const b = { nested: { a: 'one', b: 'two' }, label: 'Рояль', schemaVersion: 1, collectedAt: 'later', runtimeFingerprint: 'ignored' };
  assert.equal(receiptFingerprint(a), receiptFingerprint(b));
  assert.equal(receiptFingerprint(a), hash('{"label":"Рояль","nested":{"a":"one","b":"two"},"schemaVersion":1}'));
});

test('updater marks pending, publishes verified artifacts and skips unchanged runtime plus tool generation', async () => fixture(async ({ root, options }) => {
  const value = await receipt(root, 'a'); let builds = 0, verifications = 0;
  const update = { ...options, builder: async (input, paths) => {
    builds++; assert.equal((await readStatus(root)).state, 'pending');
    assert.equal((await readFile(join(root, 'target.json'), 'utf8')).includes('pending'), true);
    assert.ok(paths.workRoot.startsWith(join(root, 'work/update-')));
    await writeFile(join(paths.workRoot, 'scratch-source'), 'source', { mode: 0o600 });
    return built(input);
  }, verifyRuntime: async (...args) => { verifications++; return options.verifyRuntime(...args); } };
  const first = await updateProductionGraph(update);
  assert.equal(first.status, 'published'); assert.equal(builds, 1); assert.equal(verifications, 3);
  assert.equal((await readStatus(root)).state, 'ready');
  assert.deepEqual(await readdir(join(root, 'work')), []);
  const active = await loadActiveSnapshot(root);
  try { assert.equal(active.production.toolSourceCommit, commit('tool-a')); assert.match(active.production.toolGenerationHash, /^[a-f0-9]{64}$/); }
  finally { await active.close(); }
  const second = await updateProductionGraph(update);
  assert.equal(second.status, 'unchanged'); assert.equal(second.snapshotId, first.snapshotId);
  assert.equal(second.runtimeFingerprint, value.runtimeFingerprint); assert.equal(builds, 1); assert.equal(verifications, 4);
}));

test('upgrading reviewed tool and knowledge source rebuilds even with the same deployed application', async () => fixture(async ({ root, program, options }) => {
  await receipt(root, 'a');
  const first = await updateProductionGraph(options);
  await install(program, 'b');
  const second = await updateProductionGraph(options);
  assert.equal(second.status, 'published'); assert.notEqual(second.snapshotId, first.snapshotId);
  assert.equal(second.previousSnapshotId, first.snapshotId);
  assert.notEqual(second.toolGenerationHash, first.toolGenerationHash);
  assert.equal((await readStatus(root)).provenance.runtimeFingerprint, first.runtimeFingerprint);
}));

test('an unchanged graph still requires a current live proof and a failed proof closes reads', async () => fixture(async ({ root, options }) => {
  await receipt(root, 'a'); const first = await updateProductionGraph(options);
  let builds = 0;
  await assert.rejects(updateProductionGraph({ ...options,
    builder: async () => { builds++; throw new Error('unexpected build'); },
    verifyRuntime: async () => { throw new Error('private runtime stderr'); },
  }), error => error.code === 'runtime_unverified' && error.exitCode === 4 && !error.message.includes('private'));
  assert.equal(builds, 0);
  const status = await readStatus(root);
  assert.equal(status.current, first.snapshotId); assert.equal(status.state, 'failed');
  await assert.rejects(loadActiveSnapshot(root), error => error.code === 'graph_failed');
}));

test('build failure preserves the previous graph, saves safe failed status and cleans scratch files', async () => fixture(async ({ root, options }) => {
  await receipt(root, 'a'); const first = await updateProductionGraph(options);
  await receipt(root, 'b');
  await assert.rejects(updateProductionGraph({ ...options, builder: async (input, paths) => {
    await writeFile(join(paths.workRoot, 'temporary-source'), 'source', { mode: 0o600 });
    throw new Error('private provider token must not be logged');
  } }), error => error.code === 'index_failed' && !error.message.includes('token'));
  const status = await readStatus(root);
  assert.equal(status.current, first.snapshotId); assert.equal(status.state, 'failed');
  assert.deepEqual(await readdir(join(root, 'work')), []);
  assert.equal(JSON.parse(await readFile(join(root, 'target.json'), 'utf8')).errorCode, 'index_failed');
}));

test('a changed runtime during final promotion never replaces the previous active snapshot', async () => fixture(async ({ root, options }) => {
  await receipt(root, 'a'); const first = await updateProductionGraph(options);
  await receipt(root, 'b'); let checks = 0;
  await assert.rejects(updateProductionGraph({ ...options, verifyRuntime: async (path, value) => ++checks === 3 ? hash('newer-runtime') : value.runtimeFingerprint }), error => error.code === 'runtime_changed');
  assert.equal(checks, 3); assert.equal((await readStatus(root)).current, first.snapshotId);
  assert.equal((await readStatus(root)).state, 'failed');
  assert.deepEqual(await readdir(join(root, 'snapshots')), [first.snapshotId]);
  assert.deepEqual(await readdir(join(root, 'work')), []);
}));

test('a newer maintenance receipt during extraction supersedes the old build without overwriting its target', async () => fixture(async ({ root, options }) => {
  await receipt(root, 'a'); const first = await updateProductionGraph(options);
  await receipt(root, 'b'); let newer;
  await assert.rejects(updateProductionGraph({ ...options, builder: async input => { newer = await receipt(root, 'c'); return built(input); } }), error => error.code === 'runtime_changed');
  const status = await readStatus(root);
  assert.equal(status.current, first.snapshotId); assert.equal(status.target.runtimeFingerprint, newer.runtimeFingerprint);
  assert.equal(status.state, 'pending');
}));

test('updater rejects forged or linked receipts and locally modified installed tool bytes', async () => fixture(async ({ root, program, options }) => {
  const value = await receipt(root, 'a');
  await json(join(root, 'receipts/latest.json'), { ...value, release: 'forged-release' });
  await assert.rejects(updateProductionGraph(options), error => error.code === 'invalid_receipt');
  await json(join(root, 'receipts/latest.json'), value);
  await rm(join(root, 'receipts', value.runtimeFingerprint + '.json'));
  await symlink(join(root, 'receipts/latest.json'), join(root, 'receipts', value.runtimeFingerprint + '.json'));
  await assert.rejects(updateProductionGraph(options));
  await rm(join(root, 'receipts', value.runtimeFingerprint + '.json'));
  await json(join(root, 'receipts', value.runtimeFingerprint + '.json'), value);
  await writeFile(join(program, 'scripts/tool.mjs'), 'unreviewed bytes', { mode: 0o600 });
  await assert.rejects(updateProductionGraph(options), error => error.code === 'invalid_tool_receipt');
  await install(program, 'a');
  await chmod(join(root, 'receipts/latest.json'), 0o666);
  await assert.rejects(updateProductionGraph(options), error => error.code === 'untrusted_update_input');
}));

test('concurrent updates share an updater lock without holding the publication lock during extraction', async () => fixture(async ({ root, options }) => {
  await receipt(root, 'a'); let started, resume;
  const began = new Promise(accept => { started = accept; }), gate = new Promise(accept => { resume = accept; });
  const first = updateProductionGraph({ ...options, builder: async input => { started(); await gate; return built(input); } });
  await began;
  await assert.rejects(updateProductionGraph(options), error => error.code === 'update_locked');
  assert.equal((await readStatus(root)).state, 'pending');
  resume(); assert.equal((await first).status, 'published');
}));

test('retention keeps latest and both active generations and never deletes foreign or invalid receipt files', async () => fixture(async ({ root, options }) => {
  const a = await receipt(root, 'a'); await updateProductionGraph(options);
  const b = await receipt(root, 'b'); await updateProductionGraph(options);
  const recent = await receipt(root, 'recent');
  const foreign = join(root, 'receipts/financial-backup.json'); await json(foreign, { preserve: true });
  const malformed = hash('malformed'); await json(join(root, 'receipts', malformed + '.json'), { invalid: true });
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await utimes(join(root, 'receipts', a.runtimeFingerprint + '.json'), old, old);
  await utimes(join(root, 'receipts', malformed + '.json'), old, old);
  const c = await receipt(root, 'c'); const result = await updateProductionGraph(options);
  assert.deepEqual(result.removedReceipts, [a.runtimeFingerprint]);
  assert.deepEqual((await readdir(join(root, 'receipts'))).sort(),
    [b.runtimeFingerprint + '.json', c.runtimeFingerprint + '.json', recent.runtimeFingerprint + '.json', malformed + '.json', 'financial-backup.json', 'latest.json'].sort());
  assert.deepEqual(result.warnings, [{ code: 'retired_receipt_requires_review', runtimeFingerprint: malformed }]);
}));
