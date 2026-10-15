import test from 'node:test';
import assert from 'node:assert/strict';
import { access, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installProjectKnowledge, loadProjectKnowledge, projectKnowledgeMetadata,
  projectKnowledgePrompt, PROJECT_KNOWLEDGE_LIMITS } from '../lib/project-knowledge.mjs';

const execute = promisify(execFile);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function fixture(t, paths = ['docs/integration.md']) {
  const temporary = await mkdtemp(join(tmpdir(), 'royal-project-knowledge-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = join(temporary, 'knowledge');
  const source = join(temporary, 'source');
  const workspace = join(temporary, 'workspace');
  await mkdir(directory);
  await mkdir(join(source, 'docs'), { recursive: true });
  await mkdir(workspace);
  const manifest = { schema_version: 1, version: '2026-10-10.1', updated_at: '2026-10-10T00:00:00Z',
    summary: 'PROJECT.md', documents: paths };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'PROJECT.md'), 'Finance gateway is deployed. Multi-network conversion is future scope.');
  await writeFile(join(source, 'docs', 'integration.md'), 'The gateway uses two API replicas with a shared PostgreSQL database.');
  return { temporary, directory, source, workspace, manifest };
}

test('knowledge pins available evidence, reports missing references, and exports only compact metadata', async (t) => {
  const options = await fixture(t, ['docs/integration.md', 'deployment/missing.md']);
  const bundle = await loadProjectKnowledge(options);
  assert.equal(bundle.schema_version, 1);
  assert.equal(bundle.updated_at, '2026-10-10T00:00:00.000Z');
  assert.equal(bundle.documents[0].sha256, sha256(bundle.documents[0].text));
  assert.deepEqual(bundle.documents[1], { path: 'deployment/missing.md', text: null, sha256: null,
    available: false, reason: 'missing' });
  assert.deepEqual(projectKnowledgeMetadata(bundle), { version: bundle.version, sha256: bundle.hash,
    updated_at: bundle.updated_at, document_count: 1, missing_documents: ['deployment/missing.md'] });
  const prompt = projectKnowledgePrompt(bundle);
  assert.ok(prompt.includes(bundle.hash));
  assert.ok(prompt.includes(bundle.summary));
  assert.match(prompt, /Missing: deployment\/missing\.md; do not claim to have read/);
  assert.match(prompt, /older planning documents/);
  assert.match(prompt, /actual workspace code and candidate diff/);
  assert.equal(prompt.includes(bundle.documents[0].text), false);
  assert.ok(Object.isFrozen(bundle.documents[0]));
  assert.throws(() => { bundle.documents[0].text = 'Tampered evidence'; }, TypeError);
});

test('a changed guide, reference, or version produces a new fingerprint for the next run', async (t) => {
  const options = await fixture(t);
  const first = await loadProjectKnowledge(options);
  assert.equal((await loadProjectKnowledge(options)).hash, first.hash);
  await writeFile(join(options.source, 'docs', 'integration.md'), 'Gateway reference updated.');
  const second = await loadProjectKnowledge(options);
  assert.notEqual(first.hash, second.hash);
  assert.equal(first.documents[0].text.includes('two API replicas'), true);
  await writeFile(join(options.directory, 'PROJECT.md'), 'A newly verified project fact.');
  const third = await loadProjectKnowledge(options);
  assert.notEqual(third.hash, second.hash);
  await writeFile(join(options.directory, 'manifest.json'), JSON.stringify({ ...options.manifest, version: '2026-10-10.2' }));
  assert.notEqual((await loadProjectKnowledge(options)).hash, third.hash);
});

test('refresh replaces a read-only knowledge snapshot without changing application source or leaking temporary files', async (t) => {
  const options = await fixture(t);
  const candidate = join(options.workspace, 'candidate.js');
  await writeFile(candidate, 'const existingCandidate = true;');
  const before = await readFile(candidate);
  const first = await loadProjectKnowledge(options);
  const installed = await installProjectKnowledge(options.workspace, first);
  assert.equal((await lstat(installed.path)).mode & 0o777, 0o444);
  assert.deepEqual(JSON.parse(await readFile(installed.path, 'utf8')), first);
  await writeFile(join(options.directory, 'PROJECT.md'), 'Gateway now has an additional verified feature.');
  const second = await loadProjectKnowledge(options);
  await installProjectKnowledge(options.workspace, second);
  assert.equal(JSON.parse(await readFile(installed.path, 'utf8')).hash, second.hash);
  assert.deepEqual(await readFile(candidate), before);
  assert.deepEqual(await readdir(join(options.workspace, '.factory')), ['project-knowledge.json']);
});

test('unsafe allowlist paths are rejected before any document is read', async (t) => {
  const options = await fixture(t);
  for (const path of ['/tmp/a.md', '../a.md', 'docs/../a.md', 'docs//a.md', 'docs\\a.md',
    '.env/private.md', '.env.production/a.md', '.git/a.md', '.codex/a.md', '.aws/a.md',
    'credentials/a.md', 'docs/secrets.md', 'docs/private-key.md', 'docs/auth.json.md',
    'docs/a.txt', './docs/a.md', 'docs/./a.md', 'docs/%2e%2e/a.md']) {
    await writeFile(join(options.directory, 'manifest.json'), JSON.stringify({ ...options.manifest, documents: [path] }));
    await assert.rejects(loadProjectKnowledge(options), /Project knowledge:/);
  }
});

test('malformed manifests, unsupported schemas, duplicate references, and invalid timestamps fail closed', async (t) => {
  const options = await fixture(t);
  for (const value of [null, [], {}, { ...options.manifest, schema_version: 2 },
    { ...options.manifest, summary: '../PROJECT.md' }, { ...options.manifest, version: 'bad\nversion' },
    { ...options.manifest, updated_at: '2026-02-30T00:00:00Z' },
    { ...options.manifest, documents: ['docs/integration.md', 'docs/integration.md'] },
    { ...options.manifest, documents: new Array(PROJECT_KNOWLEDGE_LIMITS.documents + 1).fill('docs/integration.md') },
    { ...options.manifest, unknown_configuration: 'ignored fields must not be accepted' }]) {
    await writeFile(join(options.directory, 'manifest.json'), JSON.stringify(value));
    await assert.rejects(loadProjectKnowledge(options), /Project knowledge:/);
  }
  await writeFile(join(options.directory, 'manifest.json'), '{broken');
  await assert.rejects(loadProjectKnowledge(options), /manifest is not valid JSON/);
});

test('missing manifest or curated guide cannot silently produce an empty successful context', async (t) => {
  const options = await fixture(t);
  await rm(join(options.directory, 'PROJECT.md'));
  await assert.rejects(loadProjectKnowledge(options), { code: 'ENOENT' });
  await rm(join(options.directory, 'manifest.json'));
  await assert.rejects(loadProjectKnowledge(options), { code: 'ENOENT' });
});

test('a linked source directory or document cannot expose an external reference', async (t) => {
  const options = await fixture(t);
  const outside = join(options.temporary, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'external.md'), 'External content must not become project evidence.');
  await symlink(outside, join(options.source, 'linked'), 'dir');
  await writeFile(join(options.directory, 'manifest.json'), JSON.stringify({ ...options.manifest, documents: ['linked/external.md'] }));
  await assert.rejects(loadProjectKnowledge(options), /symbolic links are forbidden/);
  await writeFile(join(options.directory, 'manifest.json'), JSON.stringify({ ...options.manifest, documents: ['docs/linked.md'] }));
  await symlink(join(outside, 'external.md'), join(options.source, 'docs', 'linked.md'));
  await assert.rejects(loadProjectKnowledge(options), /symbolic links are forbidden/);
  await symlink(options.source, join(options.temporary, 'source-link'), 'dir');
  await assert.rejects(loadProjectKnowledge({ ...options, source: join(options.temporary, 'source-link') }), /source root must be a real directory/);
});

test('hardlinked references and linked curated guides are rejected rather than ingested', async (t) => {
  const options = await fixture(t);
  await link(join(options.source, 'docs', 'integration.md'), join(options.temporary, 'shared.md'));
  await assert.rejects(loadProjectKnowledge(options), /regular files without additional links/);
  await rm(join(options.temporary, 'shared.md'));
  await rm(join(options.directory, 'PROJECT.md'));
  await symlink(join(options.source, 'docs', 'integration.md'), join(options.directory, 'PROJECT.md'));
  await assert.rejects(loadProjectKnowledge(options), /symbolic links are forbidden/);
});

test('a FIFO document is rejected without waiting for a writer', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t, ['docs/fifo.md']);
  await execute('mkfifo', [join(options.source, 'docs', 'fifo.md')]);
  const helper = new URL('../lib/project-knowledge.mjs', import.meta.url).href;
  const source = `import {loadProjectKnowledge} from ${JSON.stringify(helper)};
    try { await loadProjectKnowledge(${JSON.stringify({ directory: options.directory, source: options.source })}); process.exitCode = 2; }
    catch { console.log('rejected'); }`;
  const result = await execute(process.execPath, ['--input-type=module', '--eval', source], { timeout: 2000 });
  assert.equal(result.stdout.trim(), 'rejected');
});

test('invalid UTF-8 and private key blocks do not enter the snapshot', async (t) => {
  const options = await fixture(t);
  await writeFile(join(options.source, 'docs', 'integration.md'), Buffer.from([0xc0, 0xaf]));
  await assert.rejects(loadProjectKnowledge(options), /valid UTF-8/);
  for (const kind of ['PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'OPENSSH PRIVATE KEY', 'RSA PRIVATE KEY']) {
    await writeFile(join(options.source, 'docs', 'integration.md'), `-----BEGIN ${kind}-----\nplaceholder\n-----END ${kind}-----`);
    await assert.rejects(loadProjectKnowledge(options), /forbidden content/);
  }
});

test('guide, individual reference, and serialized bundle sizes are bounded', async (t) => {
  const options = await fixture(t);
  await writeFile(join(options.directory, 'PROJECT.md'), 'A'.repeat(PROJECT_KNOWLEDGE_LIMITS.summary_bytes + 1));
  await assert.rejects(loadProjectKnowledge(options), /exceeds its size limit/);
  await writeFile(join(options.directory, 'PROJECT.md'), 'Current project facts.');
  await writeFile(join(options.source, 'docs', 'integration.md'), 'A'.repeat(PROJECT_KNOWLEDGE_LIMITS.document_bytes + 1));
  await assert.rejects(loadProjectKnowledge(options), /exceeds its size limit/);
  const paths = ['docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/d.md'];
  for (const path of paths) await writeFile(join(options.source, path), 'A'.repeat(PROJECT_KNOWLEDGE_LIMITS.document_bytes));
  await writeFile(join(options.directory, 'manifest.json'), JSON.stringify({ ...options.manifest, documents: paths }));
  await assert.rejects(loadProjectKnowledge(options), /bundle exceeds its size limit/);
});

test('maximum accepted guide and reference index keep the prompt below its limit', async (t) => {
  const options = await fixture(t, Array.from({ length: PROJECT_KNOWLEDGE_LIMITS.documents }, (_, index) => `docs/missing-${index}.md`));
  await writeFile(join(options.directory, 'PROJECT.md'), 'A'.repeat(PROJECT_KNOWLEDGE_LIMITS.summary_bytes));
  const bundle = await loadProjectKnowledge(options);
  assert.ok(Buffer.byteLength(projectKnowledgePrompt(bundle)) < PROJECT_KNOWLEDGE_LIMITS.prompt_bytes);
  assert.equal(bundle.documents.every((document) => document.available === false), true);
});

test('fixture directory, file, hardlinks, and workspace symlinks cannot overwrite foreign files', async (t) => {
  const options = await fixture(t);
  const bundle = await loadProjectKnowledge(options);
  const outside = join(options.temporary, 'outside');
  await mkdir(outside);
  const original = join(outside, 'original');
  await writeFile(original, 'Foreign original must remain unchanged.');
  await symlink(outside, join(options.workspace, '.factory'), 'dir');
  await assert.rejects(installProjectKnowledge(options.workspace, bundle), /managed knowledge directory/);
  await rm(join(options.workspace, '.factory'));
  await mkdir(join(options.workspace, '.factory'));
  const target = join(options.workspace, '.factory', 'project-knowledge.json');
  await symlink(original, target);
  await assert.rejects(installProjectKnowledge(options.workspace, bundle), /managed knowledge fixture/);
  await rm(target);
  await link(original, target);
  await assert.rejects(installProjectKnowledge(options.workspace, bundle), /managed knowledge fixture/);
  await rm(target);
  await symlink(options.workspace, join(options.temporary, 'workspace-link'), 'dir');
  await assert.rejects(installProjectKnowledge(join(options.temporary, 'workspace-link'), bundle), /source root must be a real directory/);
  assert.equal(await readFile(original, 'utf8'), 'Foreign original must remain unchanged.');
});

test('mutated or substituted bundle data cannot be installed with its original fingerprint', async (t) => {
  const options = await fixture(t);
  const bundle = await loadProjectKnowledge(options);
  const tampered = Object.freeze({ ...bundle, summary: 'Altered facts using the old fingerprint' });
  await assert.rejects(installProjectKnowledge(options.workspace, tampered), /fingerprint/);
  assert.throws(() => projectKnowledgeMetadata({ ...bundle }), /fingerprint/);
});

test('the controller refuses to overwrite a knowledge file already tracked in the candidate', async (t) => {
  const options = await fixture(t);
  const fallback = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/git');
  let gitBinary = 'git';
  try { await access(fallback); gitBinary = fallback; } catch {}
  await execute(gitBinary, ['init', options.workspace]);
  await execute(gitBinary, ['-C', options.workspace, 'config', 'user.name', 'Fixture Test']);
  await execute(gitBinary, ['-C', options.workspace, 'config', 'user.email', 'fixture@example.invalid']);
  await mkdir(join(options.workspace, '.factory'));
  const path = join(options.workspace, '.factory', 'project-knowledge.json');
  await writeFile(path, 'Existing tracked candidate evidence');
  await execute(gitBinary, ['-C', options.workspace, 'add', '.factory/project-knowledge.json']);
  await execute(gitBinary, ['-C', options.workspace, 'commit', '-m', 'Tracked fixture']);
  await assert.rejects(installProjectKnowledge(options.workspace, await loadProjectKnowledge(options), { gitBinary }), /must not be tracked/);
  assert.equal(await readFile(path, 'utf8'), 'Existing tracked candidate evidence');
  await execute(gitBinary, ['-C', options.workspace, 'rm', '--cached', '.factory/project-knowledge.json']);
  const installed = await installProjectKnowledge(options.workspace, await loadProjectKnowledge(options), { gitBinary });
  assert.equal(installed.path, await realpath(path));
});
