import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFixture } from '../lib/fixtures.mjs';

const execute = promisify(execFile);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-fixtures-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  const outside = join(directory, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  return { workspace, outside };
}

test('managed fixtures create and overwrite only the two supported names', async (t) => {
  const { workspace } = await fixture(t);
  for (const name of ['playwright.config.mjs', 'database-test.mjs']) {
    const initial = `A long initial fixture for ${name}`;
    await writeFixture(workspace, name, initial);
    assert.equal(await readFile(join(workspace, '.factory', name), 'utf8'), initial);
    await writeFixture(workspace, name, 'short');
    assert.equal(await readFile(join(workspace, '.factory', name), 'utf8'), 'short');
  }
  assert.deepEqual((await readdir(join(workspace, '.factory'))).sort(), ['database-test.mjs', 'playwright.config.mjs']);
});

test('unknown fixture names and traversal are rejected before writing', async (t) => {
  const { workspace, outside } = await fixture(t);
  for (const name of ['unknown.mjs', '../outside/file', '/tmp/database-test.mjs']) {
    await assert.rejects(writeFixture(workspace, name, 'data'), /Unknown managed fixture/);
  }
  assert.deepEqual(await readdir(workspace), []);
  assert.deepEqual(await readdir(outside), []);
});

test('a symlinked managed directory cannot write outside the workspace', async (t) => {
  const { workspace, outside } = await fixture(t);
  const target = join(outside, 'database-test.mjs');
  await writeFile(target, 'Outside original');
  await symlink(outside, join(workspace, '.factory'), 'dir');
  await assert.rejects(writeFixture(workspace, 'database-test.mjs', 'Replacement'));
  assert.equal(await readFile(target, 'utf8'), 'Outside original');
  assert.deepEqual(await readdir(outside), ['database-test.mjs']);
});

test('a symlinked fixture file cannot overwrite a foreign target', async (t) => {
  const { workspace, outside } = await fixture(t);
  await mkdir(join(workspace, '.factory'));
  const target = join(outside, 'private-file');
  await writeFile(target, 'Outside original');
  await symlink(target, join(workspace, '.factory', 'playwright.config.mjs'));
  await assert.rejects(writeFixture(workspace, 'playwright.config.mjs', 'Replacement'));
  assert.equal(await readFile(target, 'utf8'), 'Outside original');
});

test('a hardlinked fixture is rejected before truncating its original', async (t) => {
  const { workspace, outside } = await fixture(t);
  await mkdir(join(workspace, '.factory'));
  const original = join(outside, 'original');
  await writeFile(original, 'Shared inode original');
  const target = join(workspace, '.factory', 'database-test.mjs');
  await link(original, target);
  await assert.rejects(writeFixture(workspace, 'database-test.mjs', 'Replacement'), /regular files without additional links/);
  assert.equal(await readFile(original, 'utf8'), 'Shared inode original');
  assert.equal(await readFile(target, 'utf8'), 'Shared inode original');
});

test('a symlinked workspace root cannot overwrite a foreign managed directory', async (t) => {
  const { workspace, outside } = await fixture(t);
  await mkdir(join(outside, '.factory'));
  const original = join(outside, '.factory', 'database-test.mjs');
  await writeFile(original, 'Foreign workspace original');
  await rm(workspace, { recursive: true });
  await symlink(outside, workspace, 'dir');
  await assert.rejects(writeFixture(workspace, 'database-test.mjs', 'Replacement'));
  assert.equal(await readFile(original, 'utf8'), 'Foreign workspace original');
  assert.deepEqual(await readdir(join(outside, '.factory')), ['database-test.mjs']);
});

test('a FIFO fixture without a reader is rejected without blocking', { skip: process.platform === 'win32' }, async (t) => {
  const { workspace } = await fixture(t);
  await mkdir(join(workspace, '.factory'));
  await execute('mkfifo', [join(workspace, '.factory', 'database-test.mjs')], { timeout: 2000 });
  const helper = new URL('../lib/fixtures.mjs', import.meta.url).href;
  const source = `import {writeFixture} from ${JSON.stringify(helper)};
    try {
      await writeFixture(${JSON.stringify(workspace)}, 'database-test.mjs', 'Replacement');
      process.exitCode = 2;
    } catch {
      console.log('rejected');
    }`;
  const result = await execute(process.execPath, ['--input-type=module', '--eval', source], { timeout: 2000 });
  assert.equal(result.stdout.trim(), 'rejected');
});
