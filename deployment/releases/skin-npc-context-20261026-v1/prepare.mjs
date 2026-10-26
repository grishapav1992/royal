import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), work = resolve(root, '..'), out = resolve(work, 'payload');
const base = '27264a8cac2744aad98145631e76a291af5cbedf', name = 'skin-npc-context-20261026-v1';
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const before = json(resolve(work, 'before.json')), release = json(resolve(root, 'module-build/release-manifest.json'));
const receipt = json(resolve(root, 'module-build/release-github.json'));
assert.equal(release.sourceCommit, git('rev-parse', 'HEAD')); assert.equal(release.baseCommit, base); assert(release.build.passed);
assert.equal(receipt.sourceCommit, release.sourceCommit); assert(!git('status', '--porcelain'));
assert.equal(before.container.image, 'sha256:090153647cc919af02e41fe853e74b89f60755a146a79f2e40eb61bac389af09');
assert.deepEqual(before.program, before.preparedProgram);
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
  assert(actual === digest || before.sourceLF[file] === actual, 'Unrelated production source differs: ' + file);
}
const sameRuntime = (file, digest) => {
  if (before.program[file] === digest) return true;
  if (!/\.(html|css|js|json|svg|txt|map|md)$/i.test(file)) return false;
  if (before.programLF[file] === digest) return true;
  const publicSource = file.startsWith('dist/') ? 'public/' + file.slice(5) : '';
  return before.source[publicSource] === before.program[file] && before.sourceLF[publicSource] === digest;
};
const delta = {};
for (const [file, digest] of Object.entries(release.files)) {
  if (!file.startsWith('dist/')) continue;
  if (sameRuntime(file, digest)) continue;
  const sub = file.slice(5);
  if (sub === 'index.html' || /^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub)) {
    assert(sub === 'index.html' || !(file in before.program), 'Immutable client URL would change');
    delta[sub] = digest; copy(resolve(root, file), 'dist-delta/' + sub);
  } else assert.fail('Unrelated static client file changed: ' + file);
}
assert('index.html' in delta);
const serverDelta = { 'index.js': hash(resolve(root, 'dist-server/index.js')) };
assert.notEqual(serverDelta['index.js'], before.program['dist-server/index.js']);
copy(resolve(root, 'dist-server/index.js'), 'server-delta/index.js');
for (const [file, digest] of Object.entries(release.files)) {
  if (file.startsWith('module-dist/') || (file.startsWith('dist-server/') && file !== 'dist-server/index.js'))
    assert(sameRuntime(file, digest), 'Unrelated module or backend program changed: ' + file);
}
for (const file of ['package.json', 'package-lock.json']) assert.equal(hash(resolve(root, file)), before.program[file]);
const helper = dirname(fileURLToPath(import.meta.url));
for (const file of ['deploy.py', 'snapshot.py']) copy(resolve(helper, file), file);
for (const file of ['release-manifest.json', 'release-github.json']) copy(resolve(root, 'module-build', file), file);
const manifest = { release: name, sourceCommit: release.sourceCommit, baseCommit: base, before, changed, delta, serverDelta,
  helperSha256: hash(resolve(out, 'deploy.py')), snapshotSha256: hash(resolve(out, 'snapshot.py')) };
writeFileSync(resolve(out, 'install-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
execFileSync('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-czf', resolve(work, 'transport.tgz'), '-C', out, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
console.log(JSON.stringify({ sourceCommit: release.sourceCommit, sourceFiles: Object.keys(changed).length, clientFiles: Object.keys(delta).length,
  backendFiles: 1, deltaBytes: Object.keys(delta).reduce((sum, file) => sum + statSync(resolve(out, 'dist-delta', file)).size, statSync(resolve(out, 'server-delta/index.js')).size), transportBytes: statSync(resolve(work, 'transport.tgz')).size }));
