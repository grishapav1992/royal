import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { installGameModuleAssets } from '../server/gameModuleAssets';

async function fixture() {
 const directory = await mkdtemp(join(tmpdir(), 'royal-module-assets-'));
 const external = join(directory, 'external'), baseline = join(directory, 'baseline');
 const put = async (root: string, name: string, text: string) => {
  const path = join(root, name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
 };
 await put(baseline, 'studio-signal-fox/active.json', '{"version":"baseline"}');
 await put(baseline, 'studio-signal-fox/versions/1.0.0-aaaaaaaaaaaa/entry-1111111111111111.js', 'export const baseline = true;');
 await put(baseline, 'studio-neon-crown/active.json', '{"version":"neon"}');
 await put(baseline, '.private', 'private');
 await put(external, 'studio-signal-fox/active.json', '{"version":"installed"}');
 await put(external, 'studio-signal-fox/versions/1.1.0-bbbbbbbbbbbb/entry-2222222222222222.js', 'export const installed = true;');
 const app = express();
 installGameModuleAssets(app, external, baseline);
 app.use((_req, res) => res.type('html').send('<html>hall</html>'));
 const server = app.listen(0, '127.0.0.1');
 await once(server, 'listening');
 const address = server.address(); assert(address && typeof address !== 'string');
 return {
  url: 'http://127.0.0.1:' + address.port + '/game-modules/',
  cleanup: async () => {
   server.closeAllConnections();
   await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
   await rm(directory, { recursive: true, force: true });
  },
 };
}

test('installed game pointers override the baseline without hiding other games or retained versions', async () => {
 const f = await fixture();
 try {
  const pointer = await fetch(f.url + 'studio-signal-fox/active.json');
  assert.equal(pointer.status, 200);
  assert.deepEqual(await pointer.json(), { version: 'installed' });
  assert.equal(pointer.headers.get('cache-control'), 'no-store');
  const other = await fetch(f.url + 'studio-neon-crown/active.json');
  assert.deepEqual(await other.json(), { version: 'neon' });
  const old = await fetch(f.url + 'studio-signal-fox/versions/1.0.0-aaaaaaaaaaaa/entry-1111111111111111.js');
  assert.equal(await old.text(), 'export const baseline = true;');
  assert.match(old.headers.get('cache-control')!, /immutable/);
  assert.equal(old.headers.get('x-content-type-options'), 'nosniff');
  const installed = await fetch(f.url + 'studio-signal-fox/versions/1.1.0-bbbbbbbbbbbb/entry-2222222222222222.js');
  assert.equal(await installed.text(), 'export const installed = true;');
 } finally { await f.cleanup(); }
});

test('missing and hidden package resources return uncached errors instead of the hall HTML', async () => {
 const f = await fixture();
 try {
  for (const path of ['studio-neon-crown/versions/missing/module.js', '.private', 'studio-neon-crown/', '']) {
   const response = await fetch(f.url + path);
   assert.equal(response.status, 404);
   assert.equal(response.headers.get('cache-control'), 'no-store');
   assert.match(response.headers.get('content-type')!, /application\/json/);
   assert.deepEqual(await response.json(), { error: 'Game resource is unavailable' });
  }
 } finally { await f.cleanup(); }
});
