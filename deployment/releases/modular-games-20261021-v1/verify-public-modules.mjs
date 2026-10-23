import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) options.set(process.argv[index], process.argv[index + 1]);
const origin = new URL(options.get('--origin')).origin;
if (!origin.startsWith('https://')) throw Error('Public verification requires HTTPS');
const packages = resolve(options.get('--packages'));
const output = resolve(options.get('--output'));
const before = options.has('--before') ? JSON.parse(await readFile(resolve(options.get('--before')), 'utf8')) : undefined;
const contracts = JSON.parse(await readFile(resolve(packages, 'host-contracts.json'), 'utf8')).games;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const version = /^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/;
const result = { origin, at: new Date().toISOString(), accountsCreated: false, stakesPlaced: false, method: 'GET', games: [], resources: [], errors: [], bytes: 0 };
const retained = new Map();
for (const [path, expected] of Object.entries(before?.moduleFiles ?? {})) {
 const prefix = '/opt/royal-game-modules/';
 if (path.startsWith(prefix)) retained.set('/game-modules/' + path.slice(prefix.length), expected);
}
const require = (value, message) => { if (!value) throw Error(message); };
async function parallel(items, concurrency, task) {
 let next = 0;
 await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
  while (next < items.length) { const item = items[next++]; await task(item); }
 }));
}
async function get(path) {
 const url = new URL(path, origin);
 require(url.origin === origin && url.pathname === path && !url.search && !url.hash, 'Unsafe public resource path');
 let last;
 for (let attempt = 0; attempt < 2; attempt++) {
  try {
   const response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Cache-Control': 'no-cache' } });
   require(response.ok, `${path}: HTTP ${response.status}`);
   const bytes = Buffer.from(await response.arrayBuffer());
   result.bytes += bytes.length;
   return { bytes, cache: response.headers.get('cache-control') ?? '', type: response.headers.get('content-type') ?? '' };
  } catch (error) { last = error; }
 }
 throw last;
}
const resources = new Map();
function inventory(path, expected, gameId) {
 require(digest.test(expected), `${path}: malformed digest`);
 const existing = resources.get(path);
 require(!existing || existing.expected === expected, `${path}: conflicting resource digests`);
 resources.set(path, { expected, gameId });
}

await parallel(Object.entries(contracts), 4, async ([gameId, contract]) => {
 try {
  const path = `/game-modules/${gameId}/active.json`;
  const active = await get(path);
  require(active.cache.includes('no-store'), `${path}: active pointer is cacheable`);
  const expectedPointer = retained.get(path) ?? hash(await readFile(resolve(packages, gameId, 'active.json')));
  require(hash(active.bytes) === expectedPointer, `${path}: selected version differs from the reviewed release`);
  const pointer = JSON.parse(active.bytes.toString());
  require(pointer.format === 1 && pointer.gameId === gameId && digest.test(pointer.sha256), `${path}: invalid pointer`);
  const selected = pointer.manifest?.split('/')[4];
  require(typeof selected === 'string' && version.test(selected), `${path}: invalid selected version`);
  const root = `/game-modules/${gameId}/versions/${selected}/`;
  require(pointer.manifest === root + 'manifest.json', `${path}: manifest belongs to another package`);
  const manifest = await get(pointer.manifest);
  require(hash(manifest.bytes) === pointer.sha256, `${gameId}: manifest digest mismatch`);
  const metadata = JSON.parse(manifest.bytes.toString());
  require(metadata.gameId === gameId && metadata.version === selected && metadata.format === 1, `${gameId}: invalid manifest identity`);
  require(['apiVersion', 'rulesVersion', 'progressVersion'].every(key => metadata[key] === contract[key]), `${gameId}: incompatible host contract`);
  require(digest.test(metadata.sourceSha256) && metadata.files && typeof metadata.files === 'object', `${gameId}: invalid source inventory`);
  require(metadata.files[metadata.entry] && Array.isArray(metadata.styles) && metadata.styles.every(name => metadata.files[name]), `${gameId}: missing entry or styles`);
  for (const [name, expected] of Object.entries(metadata.files)) {
   require(/^[a-zA-Z0-9_./-]+$/.test(name) && !name.startsWith('/') && !name.split('/').some(part => part === '..' || part === '.' || !part), `${gameId}: unsafe resource name`);
   inventory(root + name, expected, gameId);
  }
  result.games.push({ gameId, version: selected, activeSha256: hash(active.bytes), manifestSha256: pointer.sha256, files: Object.keys(metadata.files).length, preservedExternalPointer: retained.has(path) });
 } catch (error) { result.errors.push({ gameId, error: error.message }); }
});
for (const [path, expected] of retained) {
 if (path.endsWith('/active.json')) continue;
 inventory(path, expected, 'retained-external-package');
}
let completed = 0;
await parallel([...resources], 6, async ([path, expected]) => {
 try {
  const resource = await get(path);
  require(hash(resource.bytes) === expected.expected, `${path}: content digest mismatch`);
  require(resource.cache.includes('immutable'), `${path}: versioned resource is not immutable`);
  result.resources.push({ path, bytes: resource.bytes.length, sha256: expected.expected });
 } catch (error) { result.errors.push({ path, error: error.message }); }
 completed++;
 if (completed % 100 === 0) process.stdout.write(JSON.stringify({ verifiedResources: completed, totalResources: resources.size }) + '\n');
});
try {
 const health = await get('/healthz');
 require(JSON.parse(health.bytes.toString()).ok === true, 'Public health check failed');
 result.health = 'passed';
} catch (error) { result.errors.push({ path: '/healthz', error: error.message }); }
result.games.sort((left, right) => left.gameId.localeCompare(right.gameId));
result.resources.sort((left, right) => left.path.localeCompare(right.path));
result.verified = result.errors.length === 0 && result.games.length === Object.keys(contracts).length;
result.completedAt = new Date().toISOString();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ verified: result.verified, games: result.games.length, resources: result.resources.length, bytes: result.bytes, errors: result.errors.length, report: output }) + '\n');
if (!result.verified) process.exitCode = 1;
