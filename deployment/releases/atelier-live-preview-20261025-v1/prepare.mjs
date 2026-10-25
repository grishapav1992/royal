import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), work = resolve(root, '..'), out = resolve(work, 'payload');
const base = 'ac364b2db6e8c107e296b3763aa63a5569c17406', name = 'atelier-live-preview-20261025-v1';
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const before = json(resolve(work, 'before.json')), release = json(resolve(root, 'module-build/release-manifest.json'));
const receipt = json(resolve(root, 'module-build/release-github.json'));
const normalized = json(resolve(work, 'source-normalized.json'));
assert.equal(release.sourceCommit, git('rev-parse', 'HEAD')); assert.equal(release.baseCommit, base); assert(release.build.passed);
assert.equal(receipt.sourceCommit, release.sourceCommit); assert(!git('status', '--porcelain'));
assert(!existsSync(out), 'Existing payload must be reviewed'); mkdirSync(out);
function copy(from, to) { const path = resolve(out, to); assert(path.startsWith(out + '/')); mkdirSync(dirname(path), { recursive: true }); copyFileSync(from, path); }
const changed = {};
for (const file of release.changed) {
  if (!/^(src|server|scripts|docs)\//.test(file)) continue;
  const source = resolve(root, file); assert(existsSync(source), file); const digest = hash(source);
  if (before.source[file] === digest) continue;
  changed[file] = digest; copy(source, 'source/' + file);
}
for (const [file, digest] of Object.entries(before.source)) {
  if (file === 'deployment/SERVER.md' || file.endsWith('.orig') || file.endsWith('.bak') || file in changed) continue;
  assert(existsSync(resolve(root, file)), file); const actual = hash(resolve(root, file));
  assert(actual === digest || (normalized[file]?.sha256 === digest && normalized[file]?.lf === actual), 'Unrelated production source differs: ' + file);
}
const delta = {};
for (const [file, digest] of Object.entries(release.files)) {
  if (!file.startsWith('dist/') || before.program[file] === digest) continue;
  const sub = file.slice(5);
  if (['index.html', 'admin.html'].includes(sub) || /^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub)) {
    assert(['index.html', 'admin.html'].includes(sub) || !(file in before.program), 'Immutable client URL would change');
    delta[sub] = digest; copy(resolve(root, file), 'dist-delta/' + sub);
  } else assert.equal(before.source['public/' + sub], digest, 'Unexpected static asset change: ' + file);
}
assert('index.html' in delta); assert(!('admin.html' in delta), 'Administration must remain unchanged');
assert.equal(hash(resolve(root, 'dist-server/index.js')), before.program['dist-server/index.js'], 'Backend must remain unchanged');
const helper = dirname(fileURLToPath(import.meta.url));
for (const file of ['deploy.py', 'snapshot.py']) copy(resolve(helper, file), file);
for (const file of ['release-manifest.json', 'release-github.json']) copy(resolve(root, 'module-build', file), file);
mkdirSync(resolve(out, 'server-delta'));
const manifest = { release: name, sourceCommit: release.sourceCommit, baseCommit: base, before, changed, delta, serverDelta: {},
  helperSha256: hash(resolve(out, 'deploy.py')), snapshotSha256: hash(resolve(out, 'snapshot.py')) };
writeFileSync(resolve(out, 'install-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
execFileSync('tar', ['-czf', resolve(work, 'transport.tgz'), '-C', out, '.']);
console.log(JSON.stringify({ sourceCommit: release.sourceCommit, sourceFiles: Object.keys(changed).length, clientFiles: Object.keys(delta).length,
  clientBytes: Object.keys(delta).reduce((sum, file) => sum + statSync(resolve(out, 'dist-delta', file)).size, 0), transportBytes: statSync(resolve(work, 'transport.tgz')).size }));
