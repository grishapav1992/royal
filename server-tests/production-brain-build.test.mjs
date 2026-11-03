import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildProductionArtifacts, restoreSource, safeSourcePath } from '../scripts/production-brain-build.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const commit = 'a'.repeat(40), otherCommit = 'b'.repeat(40);
async function put(root, path, value) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), typeof value === 'object' ? JSON.stringify(value) : value);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'royal-brain-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const programRoot = join(root, 'program'), liveRoot = join(root, 'live'), workRoot = join(root, 'work');
  await Promise.all([programRoot, liveRoot, workRoot].map(path => mkdir(path)));
  await put(programRoot, 'install-receipt.json', { sourceCommit: commit, githubVerified: true });
  await put(programRoot, 'AGENTS.md', '# Project');
  await put(programRoot, 'ai-factory/project-knowledge/manifest.json', { summary: 'PROJECT.md', documents: [] });
  await put(programRoot, 'ai-factory/project-knowledge/PROJECT.md', '# Approved context');
  await put(programRoot, 'ai-factory/project-knowledge/graph-seed.json', { schema_version: 1, version: 'test', nodes: [{ id: 'service:wallet',
    name: 'Wallet', entity_type: 'service', summary: 'Wallet source contract', status: 'verified', environment: 'project',
    evidence: [{ path: 'server/wallet.ts', sha256: sha('export const wallet = 1;\n') }] }], edges: [] });
  const descriptor = (path, bytes, sourceCommit = commit) => ({ path, sha256: sha(bytes), origin: { commit: sourceCommit, path, baseSha256: sha(bytes), patches: [] } });
  const old = 'export const wallet = 1;\n', current = 'export const wallet = 2;\n';
  await put(liveRoot, 'server/wallet.ts', current);
  const receipt = { schemaVersion: 1, verified: true, runtimeFingerprint: '1'.repeat(64), sourceCommit: commit,
    collectedAt: '2026-11-03T12:00:00Z', release: 'fixture-release', sourceInventory: { 'server/wallet.ts': sha(current) },
    components: [{ id: 'host', kind: 'host', coverage: 'complete', sourceSet: 'verified-projection-inputs', sources: [descriptor('server/wallet.ts', old)] },
      { id: 'backend', kind: 'backend', coverage: 'complete', sourceSet: 'verified-projection-inputs', sources: [descriptor('server/wallet.ts', current, otherCommit)] },
      { id: 'module:example:old', kind: 'module', gameId: 'example', version: 'old', coverage: 'partial', sourceSet: 'verified-live-candidates', sources: [] }],
    modules: [{ gameId: 'example', version: 'old', manifestSha256: '2'.repeat(64), pointerSha256: '3'.repeat(64) }] };
  return { root, programRoot, liveRoot, workRoot, receipt, old, current };
}

test('source restoration verifies canonical base, unique patch and deployed output', () => {
  const row = { sha256: sha('const value = 2;\n'), origin: { commit, path: 'src/a.ts', baseSha256: sha('const value = 1;\n'), patches: [{ from: '= 1', to: '= 2' }] } };
  assert.equal(restoreSource(Buffer.from('const value = 1;\r\n'), row).toString(), 'const value = 2;\n');
  assert.throws(() => restoreSource('changed', row), /base hash/);
  assert.throws(() => restoreSource('const value = 1;\n', { ...row, origin: { ...row.origin, patches: [{ from: 'missing', to: '2' }] } }), /not unique/);
  assert.throws(() => restoreSource('const value = 1;\n', { ...row, sha256: 'f'.repeat(64) }), /deployed projection/);
  for (const path of ['../a', '/etc/passwd', 'src/../a', 'src/.env', 'src/a.key', 'node_modules/a.js', 'src\\a.ts']) assert.equal(safeSourcePath(path), false);
});

test('mixed deployed sources stay isolated; ambiguous evidence requires review', async t => {
  const f = await fixture(t); let extraction;
  const result = await buildProductionArtifacts(f.receipt, { ...f, fetchSource: async (id, path) => {
    assert.equal(id, commit); assert.equal(path, 'server/wallet.ts'); return Buffer.from(f.old);
  }, runExtract: async request => {
    extraction = request;
    assert.equal(await readFile(join(request.components[0].root, 'server/wallet.ts'), 'utf8'), f.old);
    assert.equal(await readFile(join(request.components[1].root, 'server/wallet.ts'), 'utf8'), f.current);
    return Buffer.from('{"nodes":[],"links":[]}');
  } });
  assert.notEqual(extraction.components[0].prefix, extraction.components[1].prefix);
  const partial = extraction.components.find(item => item.scope === 'module');
  assert.equal(partial.referenceOnly, true); assert.deepEqual(partial.sources, []);
  const index = JSON.parse(result.artifacts['project-brain.json']);
  assert.equal(index.knowledgeNeedingReview, 1);
  assert.equal(index.records.find(item => item.kind === 'knowledge').evidence[0].actual, null);
  assert.equal(index.records.find(item => item.key === 'published-module:example').version, 'old');
  assert.equal(result.production.components.find(item => item.scope === 'knowledge').sourceCommit, commit);
  assert.equal(result.production.components.find(item => item.scope === 'host').sources[0].origin.commit, commit);
  await assert.rejects(access(join(f.workRoot, 'sources')), { code: 'ENOENT' });
});

test('immutable source mismatch aborts without leaving raw sources', async t => {
  const f = await fixture(t);
  await assert.rejects(buildProductionArtifacts(f.receipt, { ...f, fetchSource: async () => Buffer.from('wrong') }), /base hash/);
  await assert.rejects(access(join(f.workRoot, 'sources')), { code: 'ENOENT' });
});

test('published module assets remain hash-only references and are never fetched', async t => {
  const f = await fixture(t);
  f.receipt.components = [{ id: 'module:example:old', kind: 'module', gameId: 'example', version: 'old',
    coverage: 'partial', sourceSet: 'verified-live-candidates', sources: [{ path: 'games/example/assets/symbol.png', sha256: 'c'.repeat(64), origin: null }] }];
  const result = await buildProductionArtifacts(f.receipt, { ...f, fetchSource: async () => { throw Error('Assets must not be fetched'); }, runExtract: async request => {
    const component = request.components[0];
    assert.deepEqual(component.sources, []); assert.equal(component.inputs[0].referenceOnly, true);
    await assert.rejects(access(join(component.root, 'games/example/assets/symbol.png')), { code: 'ENOENT' });
    return Buffer.from('{"nodes":[],"links":[]}');
  } });
  assert.equal(result.production.components[0].coverage, 'partial');
  assert.equal(result.production.components[0].sources[0].path, 'games/example/assets/symbol.png');
});

test('unambiguous production code evidence links to exact source hashes', async t => {
  const f = await fixture(t);
  f.receipt.components = f.receipt.components.slice(0, 1);
  f.receipt.sourceInventory = {};
  let extraction;
  const result = await buildProductionArtifacts(f.receipt, { ...f, fetchSource: async () => Buffer.from(f.old), runExtract: async request => {
    extraction = request; return Buffer.from('{"nodes":[],"links":[]}');
  } });
  const index = JSON.parse(result.artifacts['project-brain.json']);
  assert.equal(index.knowledgeNeedingReview, 0);
  assert.equal(index.records.find(item => item.kind === 'knowledge').evidence[0].actual, sha(f.old));
  const context = extraction.components.find(item => item.scope === 'knowledge');
  assert.equal(context.inputs.find(item => item.path === 'server/wallet.ts').evidenceOnly, true);
  assert.ok(!context.sources.includes('server/wallet.ts'));
});
