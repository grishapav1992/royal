import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hydratePostgresLinks } from '../lib/postgres-links.mjs';

const options = { variant: 'linux-x64' };
const libraries = [
  ['libpq.so.5', 'libpq.so.5.17'],
  ['libicuuc.so.60', 'libicuuc.so.60.2'],
  ['libicui18n.so.60', 'libicui18n.so.60.2'],
  ['libicudata.so.60', 'libicudata.so.60.2'],
];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-pg-links-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  const outside = join(directory, 'outside');
  const packageRoot = join(workspace, 'node_modules', '@embedded-postgres', 'linux-x64');
  const lib = join(packageRoot, 'native', 'lib');
  await mkdir(workspace);
  await mkdir(outside);
  return { directory, workspace, outside, packageRoot, lib };
}

async function sourceLibraries(lib) {
  await mkdir(lib, { recursive: true });
  for (const [, target] of libraries) await writeFile(join(lib, target), `Synthetic library ${target}`);
}

const rejectedLayout = (error) => error.code === 'POSTGRES_LINKS_UNSAFE';

test('hydrates only four fixed relative links and is idempotent', async (t) => {
  const { workspace, packageRoot, lib } = await fixture(t);
  await sourceLibraries(lib);
  const scripts = join(packageRoot, 'scripts');
  await mkdir(scripts);
  await writeFile(join(scripts, 'hydrate-symlinks.js'), 'throw new Error("Package scripts must never execute");');
  await writeFile(join(lib, 'unrelated-library'), 'unchanged');
  const first = await hydratePostgresLinks(workspace, options);
  assert.equal(first.skipped, false);
  assert.deepEqual(first.created.sort(), libraries.map(([name]) => name).sort());
  for (const [name, target] of libraries) {
    assert.equal(await readlink(join(lib, name)), target);
    assert.equal(await readFile(join(lib, target), 'utf8'), `Synthetic library ${target}`);
  }
  assert.equal(await readFile(join(lib, 'unrelated-library'), 'utf8'), 'unchanged');
  const second = await hydratePostgresLinks(workspace, options);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.existing.sort(), libraries.map(([name]) => name).sort());
});

test('a missing optional package is skipped without creating directories', async (t) => {
  const { workspace } = await fixture(t);
  assert.deepEqual(await hydratePostgresLinks(workspace, options), { skipped: true, reason: 'missing_package', created: [], existing: [] });
  assert.deepEqual(await readdir(workspace), []);
  assert.equal((await hydratePostgresLinks(workspace, { variant: null })).reason, 'unsupported_platform');
  await assert.rejects(hydratePostgresLinks(workspace, { variant: '../../outside' }), rejectedLayout);
});

test('a package symlink outside the workspace is rejected without modifying its target', async (t) => {
  const { workspace, outside, packageRoot } = await fixture(t);
  const externalLib = join(outside, 'native', 'lib');
  await sourceLibraries(externalLib);
  await mkdir(join(workspace, 'node_modules', '@embedded-postgres'), { recursive: true });
  await symlink(outside, packageRoot, 'dir');
  await assert.rejects(hydratePostgresLinks(workspace, options), rejectedLayout);
  assert.deepEqual((await readdir(externalLib)).sort(), libraries.map(([, target]) => target).sort());
});

test('a symlinked node_modules parent is rejected before following foreign directories', async (t) => {
  const { workspace, outside } = await fixture(t);
  await sourceLibraries(join(outside, '@embedded-postgres', 'linux-x64', 'native', 'lib'));
  await symlink(outside, join(workspace, 'node_modules'), 'dir');
  await assert.rejects(hydratePostgresLinks(workspace, options), rejectedLayout);
  assert.equal((await readdir(join(outside, '@embedded-postgres', 'linux-x64', 'native', 'lib'))).length, 4);
});

test('a native library directory outside the package is rejected', async (t) => {
  const { workspace, outside, packageRoot, lib } = await fixture(t);
  await sourceLibraries(outside);
  await mkdir(join(packageRoot, 'native'), { recursive: true });
  await symlink(outside, lib, 'dir');
  await assert.rejects(hydratePostgresLinks(workspace, options), rejectedLayout);
  assert.equal((await readdir(outside)).length, 4);
});

test('a source library symlink outside the package is rejected before any links are written', async (t) => {
  const { workspace, outside, lib } = await fixture(t);
  await sourceLibraries(lib);
  const external = join(outside, 'private-file');
  await writeFile(external, 'Outside data');
  await rm(join(lib, libraries[3][1]));
  await symlink(external, join(lib, libraries[3][1]));
  await assert.rejects(hydratePostgresLinks(workspace, options), rejectedLayout);
  assert.equal((await readdir(lib)).length, 4);
  assert.equal(await readFile(external, 'utf8'), 'Outside data');
});

test('wrong existing links are rejected without reading or replacing their targets', async (t) => {
  const { workspace, outside, lib } = await fixture(t);
  await sourceLibraries(lib);
  const external = join(outside, 'unrelated');
  await writeFile(external, 'Do not alter');
  await symlink(external, join(lib, libraries[3][0]));
  await assert.rejects(hydratePostgresLinks(workspace, options), rejectedLayout);
  assert.equal(await readlink(join(lib, libraries[3][0])), external);
  assert.equal(await readFile(external, 'utf8'), 'Do not alter');
  assert.equal((await readdir(lib)).length, 5);
});

test('regular files at link destinations and incomplete packages are rejected', async (t) => {
  const { workspace, lib } = await fixture(t);
  await sourceLibraries(lib);
  await writeFile(join(lib, libraries[0][0]), 'An existing file');
  await assert.rejects(hydratePostgresLinks(workspace, options), rejectedLayout);
  assert.equal(await readFile(join(lib, libraries[0][0]), 'utf8'), 'An existing file');
  await rm(join(lib, libraries[0][0]));
  await rm(join(lib, libraries[3][1]));
  await assert.rejects(hydratePostgresLinks(workspace, options), { code: 'POSTGRES_LINKS_MISSING' });
  assert.equal((await readdir(lib)).length, 3);
});
