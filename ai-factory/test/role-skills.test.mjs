import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { loadRoleSkills } from '../lib/role-skills.mjs';

const execute = promisify(execFile);
const roles = { analyst: 'royal-analysis', developer: 'royal-development', tester: 'royal-testing' };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'factory-role-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lib = join(root, 'lib');
  const skills = join(root, 'role-skills');
  const directory = join(skills, 'royal-analysis');
  await mkdir(lib);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'SKILL.md');
  await Promise.all([
    copyFile(new URL('../lib/role-skills.mjs', import.meta.url), join(lib, 'role-skills.mjs')),
    copyFile(new URL('../lib/roles.mjs', import.meta.url), join(lib, 'roles.mjs')),
    copyFile(new URL('../role-skills/royal-analysis/SKILL.md', import.meta.url), path),
  ]);
  const relocated = await import(pathToFileURL(join(lib, 'role-skills.mjs')).href);
  return { root, skills, directory, path, load: relocated.loadRoleSkills };
}

test('each role receives its actual shipped instructions with an exact file hash and version', async () => {
  for (const [role, id] of Object.entries(roles)) {
    const file = await readFile(new URL(`../role-skills/${id}/SKILL.md`, import.meta.url));
    const result = await loadRoleSkills(role, [id]);
    assert.deepEqual(result.skills, [{ id, version: '1.2.0', sha256: createHash('sha256').update(file).digest('hex') }]);
    const body = file.toString('utf8').split('\n---\n')[1].trim();
    assert.ok(result.instructions.endsWith(body));
    for (const other of Object.values(roles).filter(skill => skill !== id)) {
      assert.equal(result.instructions.includes(`## ${other} (`), false);
    }
  }
});

test('an explicitly empty skill selection supplies no instructions or metadata', async () => {
  for (const role of Object.keys(roles)) assert.deepEqual(await loadRoleSkills(role, []), { instructions: '', skills: [] });
});

test('unknown roles, arbitrary paths, duplicate IDs, and skills for a different role are rejected', async () => {
  for (const selection of [null, {}, 'royal-analysis', [null], ['../royal-analysis'], ['/tmp/secret'],
    ['royal-analysis', 'royal-analysis'], ['royal-development'], ['unknown'], ['__proto__']]) {
    await assert.rejects(loadRoleSkills('analyst', selection), /catalog skills/);
  }
  for (const role of ['release', '__proto__', null]) await assert.rejects(loadRoleSkills(role, []), /unknown role/);
});

test('the loader rejects a symlinked skill root', async (t) => {
  const { root, skills, load } = await fixture(t);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await rm(skills, { recursive: true });
  await symlink(outside, skills, 'dir');
  await assert.rejects(load('analyst', ['royal-analysis']), /skill root/);
});

test('the loader rejects a symlinked skill directory and file', async (t) => {
  const { root, directory, path, load } = await fixture(t);
  const outside = join(root, 'outside');
  await mkdir(outside);
  const foreign = join(outside, 'SKILL.md');
  await writeFile(foreign, await readFile(path));
  await rm(directory, { recursive: true });
  await symlink(outside, directory, 'dir');
  await assert.rejects(load('analyst', ['royal-analysis']), /canonical directory/);
  await rm(directory);
  await mkdir(directory);
  await symlink(foreign, path);
  await assert.rejects(load('analyst', ['royal-analysis']), /regular file/);
});

test('the loader rejects a hardlinked skill file', async (t) => {
  const { root, path, load } = await fixture(t);
  await link(path, join(root, 'extra-link'));
  await assert.rejects(load('analyst', ['royal-analysis']), /additional links/);
});

test('a FIFO skill file is rejected without waiting for a writer', { skip: process.platform === 'win32', timeout: 2000 }, async (t) => {
  const { path, load } = await fixture(t);
  await rm(path);
  await execute('mkfifo', [path], { timeout: 1000 });
  await assert.rejects(load('analyst', ['royal-analysis']), /regular file/);
});

test('the loader rejects empty, oversized, non-UTF8, and malformed managed instructions', async (t) => {
  const { path, load } = await fixture(t);
  const original = await readFile(path, 'utf8');
  for (const invalid of [Buffer.alloc(0), Buffer.alloc(16 * 1024 + 1, 'a'), Buffer.from([0xff]),
    original.replace('name: royal-analysis', 'name: royal-testing'),
    original.replace(/version: "[0-9.]+"/, 'version: "unversioned"'),
    original.slice(0, original.indexOf('\n---\n') + 5),
    `${original}\u0000`, `${original}${String.fromCodePoint(0x2014)}`]) {
    await writeFile(path, invalid);
    await assert.rejects(load('analyst', ['royal-analysis']));
  }
});

test('metadata reflects the instructions actually supplied after a managed skill revision', async (t) => {
  const { path, load } = await fixture(t);
  const first = await load('analyst', ['royal-analysis']);
  const modified = (await readFile(path, 'utf8')).replace(/version: "[0-9.]+"/, 'version: "1.2.1"') + '\nAdditional managed guidance.\n';
  await writeFile(path, modified);
  const second = await load('analyst', ['royal-analysis']);
  assert.equal(second.skills[0].version, '1.2.1');
  assert.notEqual(second.skills[0].sha256, first.skills[0].sha256);
  assert.equal(second.skills[0].sha256, createHash('sha256').update(modified).digest('hex'));
  assert.ok(second.instructions.endsWith('Additional managed guidance.'));
});
