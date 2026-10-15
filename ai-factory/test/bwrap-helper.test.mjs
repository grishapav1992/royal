import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const adapter = fileURLToPath(new URL('../deployment/bwrap', import.meta.url));
async function helperArgs(args, { authDirectory, nativeBinary, helperBinary }) {
  const { stdout } = await exec('/bin/bash', ['-c', 'source "$1"; shift; royal_helper_args "$@" || exit $?; printf "%s\\0" "${ROYAL_BWRAP_ARGS[@]}"', 'royal-helper-test', adapter, authDirectory, nativeBinary, helperBinary, ...args]);
  return stdout.split('\0').slice(0, -1);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'royal-helper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authDirectory = join(root, 'auth');
  const directory = join(authDirectory, 'tmp', 'arg0', 'codex-arg0Ab123x');
  await mkdir(directory, { recursive: true });
  const nativeBinary = join(root, 'native');
  const helperBinary = join(root, 'helper');
  const alias = join(directory, 'codex-linux-sandbox');
  await writeFile(nativeBinary, 'installed native helper');
  await symlink(nativeBinary, helperBinary);
  await symlink(nativeBinary, alias);
  return { alias, options: { authDirectory, nativeBinary, helperBinary } };
}

test('replaces only the verified ephemeral helper command, preserving all policy arguments', async t => {
  const { alias, options } = await fixture(t);
  const args = ['--unshare-user', '--ro-bind', '/usr', '/usr', '--', alias, '--policy', '{"denied":"auth"}', '--', '/bin/true'];
  assert.deepEqual(await helperArgs(args, options), [...args.slice(0, 5), options.helperBinary, ...args.slice(6)]);
  assert.equal(args[5], alias);
});

test('does not rewrite helper-like text in policy arguments or an ordinary command', async t => {
  const { alias, options } = await fixture(t);
  for (const args of [['--setenv', 'TEXT', alias, '--', '/bin/true'], ['--', '/bin/echo', alias], ['--', `${options.authDirectory}/auth.json`], [alias]]) {
    assert.deepEqual(await helperArgs(args, options), args);
  }
});

test('rejects an alias to a different executable', async t => {
  const { alias, options } = await fixture(t);
  await rm(alias); await symlink('/bin/sh', alias);
  await assert.rejects(helperArgs(['--', alias], options), error => error.code === 1);
});

test('rejects a regular file and a replaced trusted alias', async t => {
  const { alias, options } = await fixture(t);
  await rm(alias); await writeFile(alias, 'unexpected executable');
  await assert.rejects(helperArgs(['--', alias], options), error => error.code === 1);
  await rm(alias); await symlink(options.nativeBinary, alias);
  await rm(options.helperBinary); await symlink('/bin/sh', options.helperBinary);
  await assert.rejects(helperArgs(['--', alias], options), error => error.code === 1);
});
