import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { git, syncWork } from '../scripts/sync-work.mjs';

const parent = resolve('artifacts/work/work-sync-tests-' + process.pid);
await mkdir(parent, { recursive: true });
await writeFile(resolve(parent, 'owner.json'), JSON.stringify({ owner: 'work-sync tests', purpose: 'Two local devices and a local bare origin', cleanupCondition: 'Remove at test completion' }));
test.after(() => rm(parent, { recursive: true, force: true }));
const sync = (root, options = {}) => syncWork(root, { log: () => {}, ...options });
async function identity(root) {
  await git(root, ['config', 'user.name', 'Workflow test']);
  await git(root, ['config', 'user.email', 'workflow@example.invalid']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
}
async function commit(root, path, value) {
  await writeFile(resolve(root, path), value);
  await git(root, ['add', '--', path]);
  await git(root, ['commit', '-qm', 'Update ' + path]);
}
async function fixture(t) {
  const folder = await mkdtemp(resolve(parent, 'case-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const origin = resolve(folder, 'origin.git'), first = resolve(folder, 'first'), second = resolve(folder, 'second');
  await git(folder, ['init', '--bare', '-q', origin]);
  await git(folder, ['init', '-q', '-b', 'main', first]);
  await identity(first);
  await commit(first, 'file.txt', 'baseline\n');
  await git(first, ['remote', 'add', 'origin', origin]);
  await git(first, ['push', '-qu', 'origin', 'main']);
  await git(folder, ['clone', '-q', '-b', 'main', origin, second]);
  await identity(second);
  return { folder, origin, first, second };
}

test('a new feature starts from fetched main and updates actual working files without tracking main', async t => {
  const f = await fixture(t);
  await commit(f.first, 'file.txt', 'new main\n'); await git(f.first, ['push', '-q', 'origin', 'main']);
  const result = await sync(f.second, { newFeature: 'new-chat' });
  assert.equal(result.branch, 'feature/new-chat');
  assert.equal(await readFile(resolve(f.second, 'file.txt'), 'utf8'), 'new main\n');
  assert.equal(result.commit, result.mainCommit);
  assert.equal(await git(f.second, ['branch', '--show-current']), 'feature/new-chat');
  await assert.rejects(git(f.second, ['rev-parse', '--abbrev-ref', '@{upstream}']));
});

test('dirty or untracked work survives a failed synchronization, while freshness is still fetched', async t => {
  const f = await fixture(t);
  await commit(f.first, 'remote.txt', 'remote change'); await git(f.first, ['push', '-q', 'origin', 'main']);
  const head = await git(f.second, ['rev-parse', 'HEAD']);
  await writeFile(resolve(f.second, 'file.txt'), 'unfinished local change');
  await assert.rejects(sync(f.second), /Uncommitted/);
  assert.equal(await readFile(resolve(f.second, 'file.txt'), 'utf8'), 'unfinished local change');
  assert.equal(await git(f.second, ['rev-parse', 'HEAD']), head);
  assert.equal(await git(f.second, ['rev-parse', 'origin/main']), await git(f.first, ['rev-parse', 'HEAD']));
  await git(f.second, ['checkout', '--', 'file.txt']);
  await writeFile(resolve(f.second, 'draft.txt'), 'untracked');
  await assert.rejects(sync(f.second), /Uncommitted/);
  assert.equal(await readFile(resolve(f.second, 'draft.txt'), 'utf8'), 'untracked');
});

test('local unpublished main commits are preserved and never pushed or reset', async t => {
  const f = await fixture(t);
  await commit(f.second, 'private-work.txt', 'unpublished source');
  const head = await git(f.second, ['rev-parse', 'HEAD']), remote = await git(f.first, ['rev-parse', 'HEAD']);
  await assert.rejects(sync(f.second), /unpublished commits/);
  assert.equal(await git(f.second, ['rev-parse', 'HEAD']), head);
  assert.equal(await git(f.first, ['rev-parse', 'HEAD']), remote);
});

test('two devices reconcile a shared feature and fresh main without rewriting either device commit', async t => {
  const f = await fixture(t);
  await sync(f.first, { newFeature: 'shared-chat' });
  await commit(f.first, 'first.txt', 'first device');
  await git(f.first, ['push', '-qu', 'origin', 'feature/shared-chat']);
  await git(f.second, ['fetch', 'origin']);
  await git(f.second, ['switch', '--track', 'origin/feature/shared-chat']);
  await commit(f.second, 'second.txt', 'second device');
  const secondCommit = await git(f.second, ['rev-parse', 'HEAD']);
  await commit(f.first, 'remote-feature.txt', 'newer first device work');
  const firstCommit = await git(f.first, ['rev-parse', 'HEAD']);
  await git(f.first, ['push', '-q', 'origin', 'feature/shared-chat']);
  await git(f.first, ['switch', 'main']);
  await commit(f.first, 'main-change.txt', 'another completed feature');
  await git(f.first, ['push', '-q', 'origin', 'main']);
  const result = await sync(f.second);
  for (const path of ['first.txt', 'second.txt', 'remote-feature.txt', 'main-change.txt']) assert(await readFile(resolve(f.second, path), 'utf8'));
  await git(f.second, ['merge-base', '--is-ancestor', firstCommit, 'HEAD']);
  await git(f.second, ['merge-base', '--is-ancestor', secondCommit, 'HEAD']);
  assert.equal(result.mainCommit, await git(f.first, ['rev-parse', 'HEAD']));
  assert.equal(await git(f.second, ['status', '--porcelain']), '');
});

test('conflicting changes stop with both histories retained for explicit resolution', async t => {
  const f = await fixture(t);
  await sync(f.second, { newFeature: 'conflict' });
  await commit(f.second, 'file.txt', 'feature version\n');
  const local = await git(f.second, ['rev-parse', 'HEAD']);
  await commit(f.first, 'file.txt', 'main version\n'); await git(f.first, ['push', '-q', 'origin', 'main']);
  await assert.rejects(sync(f.second), /Could not reconcile/);
  assert.equal(await git(f.second, ['rev-parse', 'HEAD']), local);
  assert.match(await git(f.second, ['status', '--porcelain']), /UU file.txt/);
  const contents = await readFile(resolve(f.second, 'file.txt'), 'utf8');
  assert(contents.includes('feature version') && contents.includes('main version'));
});

test('failed fetch and detached snapshots never claim successful synchronization', async t => {
  const f = await fixture(t), head = await git(f.second, ['rev-parse', 'HEAD']);
  await git(f.second, ['remote', 'set-url', 'origin', resolve(f.folder, 'missing.git')]);
  await assert.rejects(sync(f.second), /Freshness could not be verified/);
  assert.equal(await git(f.second, ['rev-parse', 'HEAD']), head);
  await git(f.second, ['remote', 'set-url', 'origin', f.origin]);
  await git(f.second, ['checkout', '--detach', '-q']);
  await assert.rejects(sync(f.second), /detached source snapshots/);
  assert.equal(await git(f.second, ['rev-parse', 'HEAD']), head);
});

test('invalid names and an attempt to abandon an existing feature are rejected', async t => {
  const f = await fixture(t);
  await assert.rejects(sync(f.second, { newFeature: '../escape' }), /lowercase feature name/);
  await sync(f.second, { newFeature: 'first' });
  await commit(f.second, 'unique.txt', 'feature work');
  await assert.rejects(sync(f.second, { newFeature: 'second' }), /Save the current feature/);
  assert.equal(await git(f.second, ['branch', '--show-current']), 'feature/first');
  assert.equal(await readFile(resolve(f.second, 'unique.txt'), 'utf8'), 'feature work');
});
