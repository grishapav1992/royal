import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { collectLoadSource, packLoadSource } from '../pack-load-test-source.mjs';

const current = await collectLoadSource();
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'royal-load-pack-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of current.filter(file => !/^(?:src|server|public)\//.test(file.path))) {
    await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), '{}');
  }
  for (const tree of ['src', 'server', 'public']) await mkdir(join(root, tree));
  await writeFile(join(root, 'src', 'safe.ts'), 'export const safe = true;');
  return root;
}
test('current allowlist includes build inputs but excludes env, data and generated files', () => {
  assert.ok(current.some(file => file.path === 'server/finance/role-safety.sql'));
  assert.ok(current.some(file => file.path === 'server/card-engine/go.mod'));
  assert.ok(current.some(file => file.path === 'scripts/build-load-stand.mjs'));
  assert.ok(current.some(file => file.path === 'scripts/load-account-probe.ts'));
  assert.ok(current.some(file => file.path === 'scripts/load-generator-completion.ts'));
  assert.equal(current.some(file => file.path.split('/').some(part => /^(?:\.env(?:\..*)?|node_modules|artifacts|backups?|data|runtime|dist(?:-.*)?|\._.*)$/.test(part))), false);
});
test('every local Docker COPY source and both runtime card engines are present in the isolated build context', () => {
  const docker = current.find(file => file.path === 'Dockerfile.load').data.toString();
  const lines = docker.replace(/\\\r?\n\s*/g, ' ').split('\n');
  for (const line of lines.filter(line => line.startsWith('COPY ') && !line.startsWith('COPY --from='))) {
    const sources = line.trim().split(/\s+/).slice(1, -1);
    for (const source of sources) assert.equal(current.some(file => file.path === source || file.path.startsWith(source + '/')), true,
      'Missing isolated build source: ' + source);
  }
  const runtime = current.find(file => file.path === 'server/games/cardEngine.ts').data.toString();
  const expected = [...runtime.matchAll(/resolve\('dist-server\/([^']+)'\)/g)].map(match => match[1]);
  assert.equal(new Set(expected).size, 2);
  for (const binary of expected) {
    assert.ok(current.some(file => file.path === 'server/' + binary + '/go.mod'));
    assert.ok(lines.some(line => line.startsWith('RUN ') && line.includes('go build') && line.includes('-o /' + binary + ' ')));
    assert.ok(lines.includes('COPY --from=cards /' + binary + ' ./dist-server/' + binary));
  }
});
test('env and credential extensions inside allowed trees never enter archive', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'src/.env'), 'DO_NOT_COPY'); await writeFile(join(root, 'server/.env.private'), 'DO_NOT_COPY');
  await writeFile(join(root, 'public/private.key'), 'DO_NOT_COPY');
  await mkdir(join(root, 'public/backups')); await writeFile(join(root, 'public/backups/real.json'), 'DO_NOT_COPY');
  const output = join(root, 'context.tar.gz'); await packLoadSource(output, root);
  const archive = gunzipSync(await readFile(output));
  assert.equal(archive.includes(Buffer.from('DO_NOT_COPY')), false); assert.ok(archive.includes(Buffer.from('src/safe.ts')));
  assert.equal(archive.subarray(-1024).equals(Buffer.alloc(1024)), true);
  await assert.rejects(packLoadSource(output, root), error => error.code === 'EEXIST');
});
test('source symlink cannot include a private file', async t => {
  const root = await fixture(t); await writeFile(join(root, '.env'), 'private');
  await symlink(join(root, '.env'), join(root, 'src/leak.ts'));
  await assert.rejects(collectLoadSource(root), /source-symlink-refused/);
});
test('source hardlink cannot include a private file', async t => {
  const root = await fixture(t); await writeFile(join(root, '.env'), 'private');
  await link(join(root, '.env'), join(root, 'src/leak.ts'));
  await assert.rejects(collectLoadSource(root), /regular-bounded-source-required/);
});
