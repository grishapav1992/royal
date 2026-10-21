import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = 'deployment/releases/girlhub-sidebar-20261021-v1/';
const origin = 'https://stealth-spark-gokmxooi.expresshost.cloud';
const expected = JSON.parse(await readFile('module-dist/studio-afterglow/active.json'));
const manifestPath = 'module-dist/' + expected.manifest.slice('/game-modules/'.length);
const bytes = await readFile(manifestPath);
const metadata = JSON.parse(bytes);
const sha = value => createHash('sha256').update(value).digest('hex');
const results = [];
async function get(path, digest, status = 200) {
 const response = await fetch(origin + path, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000) });
 const body = Buffer.from(await response.arrayBuffer());
 if (response.status !== status) throw Error('Unexpected response: ' + path + ': ' + response.status);
 if (digest && sha(body) !== digest) throw Error('Public bytes differ: ' + path);
 const result = { path, status: response.status, bytes: body.length, sha256: sha(body), cache: response.headers.get('cache-control') };
 results.push(result);
 return { response, body };
}
const active = await get('/game-modules/studio-afterglow/active.json');
if (JSON.stringify(JSON.parse(active.body)) !== JSON.stringify(expected)) throw Error('Wrong public active pointer');
if (!active.response.headers.get('cache-control')?.includes('no-store')) throw Error('Active pointer is cached');
await get(expected.manifest, sha(bytes));
const base = expected.manifest.slice(0, expected.manifest.lastIndexOf('/') + 1);
const files = Object.entries(metadata.files);
for (let start = 0; start < files.length; start += 6) {
 await Promise.all(files.slice(start, start + 6).map(async ([name, digest]) => {
  const result = await get(base + name, digest);
  if (!result.response.headers.get('cache-control')?.includes('immutable')) throw Error('Version resource is not immutable: ' + name);
 }));
}
const health = JSON.parse((await get('/healthz')).body);
if (health.ok !== true) throw Error('Production health check failed');
await get('/api/demo-wallet', undefined, 401);
await writeFile(directory + 'public-http.json', JSON.stringify({ verified: true, moduleVersion: metadata.version,
 manifestSha256: sha(bytes), requests: results.length, health: { ok: health.ok }, results }, null, 2) + '\n');
console.log(JSON.stringify({ verified: true, moduleVersion: metadata.version, requests: results.length, health: health.ok }));
