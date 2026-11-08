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
  for (const file of current.filter(file => !/^(?:src|server)\//.test(file.path))) {
    await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), '{}');
  }
  for (const tree of ['src', 'server', 'public']) await mkdir(join(root, tree));
  await writeFile(join(root, 'src', 'safe.ts'), 'export const safe = true;');
  return root;
}
test('current allowlist includes build inputs but excludes env, data and generated files', () => {
  assert.ok(current.some(file => file.path === 'server/finance/role-safety.sql'));
  assert.ok(current.some(file => file.path === 'scripts/build-load-stand.mjs'));
  assert.ok(current.some(file => file.path === 'scripts/load-account-probe.ts'));
  assert.ok(current.some(file => file.path === 'scripts/load-generator-completion.ts'));
  assert.ok(current.some(file => file.path === 'scripts/load-lobby-server.ts'));
  assert.ok(current.some(file => file.path === 'deployment/load-stand-runtime/package-lock.json'));
  assert.equal(current.some(file => /^(?:public\/|games\/|server\/card-engine(?:-v1)?\/)/.test(file.path)), false);
  assert.equal(current.some(file => file.path.split('/').some(part => /^(?:\.env(?:\..*)?|node_modules|artifacts|backups?|data|runtime|dist(?:-.*)?|\._.*)$/.test(part))), false);
});
test('isolated image copies only its build context and preserves the supervisor bundle alias', () => {
  const docker = current.find(file => file.path === 'Dockerfile.load').data.toString();
  const lines = docker.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/);
  for (const line of lines.filter(line => line.startsWith('COPY ') && !line.startsWith('COPY --from='))) {
    const sources = line.trim().split(/\s+/).slice(1, -1);
    for (const source of sources) assert.equal(current.some(file => source.endsWith('*.ts')
      ? file.path.startsWith(source.slice(0, -4)) && file.path.endsWith('.ts')
      : file.path === source || file.path.startsWith(source + '/')), true, 'Missing isolated build source: ' + source);
  }
  assert.ok(lines.includes('COPY --from=build /app/dist-load/lobby-server.mjs ./dist-server/index.js'));
  assert.ok(lines.some(line => line.startsWith('ENTRYPOINT ') && line.includes('/app/dist-load/lobby-server.mjs')));
  assert.ok(lines.some(line => line.startsWith('RUN ') && line.includes('--stand-runtime deployment/load-stand-runtime')));
  assert.ok(lines.includes('COPY --from=build /isolated-runtime-supplements/ ./node_modules/'));
  assert.doesNotMatch(docker, /(?:npm run build|go build|COPY public|\/app\/dist \.\/dist)/);
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
