import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const options = new Map();
let dryRun = false;
for (let index = 2; index < process.argv.length; index++) {
 const flag = process.argv[index];
 if (flag === '--dry-run') { dryRun = true; continue; }
 if (!['--origin', '--manifest', '--output', '--concurrency'].includes(flag) || !process.argv[index + 1]) throw Error('Unknown or incomplete option: ' + flag);
 options.set(flag, process.argv[++index]);
}
const originURL = new URL(options.get('--origin') || 'https://stealth-spark-gokmxooi.expresshost.cloud');
if (originURL.protocol !== 'https:' || originURL.username || originURL.password || originURL.search || originURL.hash || originURL.pathname !== '/') throw Error('A plain HTTPS origin is required');
const origin = originURL.origin;
const concurrency = Number(options.get('--concurrency') || 3);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('Concurrency must be between one and four');
const manifestPath = resolve(options.get('--manifest') || 'artifacts/game-entry-20261022/shipping/install-manifest.json');
const output = resolve(options.get('--output') || 'artifacts/game-entry-20261022/proof/public-assets.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const targetIDs = ['studio-cosmic-escape', 'studio-caramel-carnival', 'studio-velvet-reign', 'studio-last-convoy', 'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload'];
const requiredRetained = ['studio-dracona', 'original-cr-vs-leo', 'royal-plinko'];
const retainedHost = 'assets/index-BpF0i3G_.js';
const digest = /^[a-f0-9]{64}$/;
const assert = (ok, message) => { if (!ok) throw Error(message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function safe(path) {
 assert(typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'), 'Unsafe inventory path');
 return path;
}
assert(/^[a-f0-9]{40}$/.test(manifest.sourceCommit), 'Missing reviewed source commit');
assert(JSON.stringify(Object.keys(manifest.modules).sort()) === JSON.stringify([...targetIDs].sort()), 'Unexpected target module set');
for (const [path, expected] of Object.entries(manifest.delta)) { safe(path); assert(digest.test(expected), 'Invalid client digest'); }
assert(digest.test(manifest.delta['index.html']), 'Missing expected root index');
const retainedPointers = Object.entries(manifest.before.moduleFiles)
 .filter(([path]) => path.startsWith('/opt/royal-game-modules/') && path.endsWith('/active.json'))
 .map(([path, sha256]) => ({ gameId: path.slice('/opt/royal-game-modules/'.length).split('/')[0], sha256 }))
 .filter(value => !targetIDs.includes(value.gameId));
for (const gameId of requiredRetained) assert(retainedPointers.some(value => value.gameId === gameId), 'Missing retained pointer evidence: ' + gameId);
const hostHash = manifest.before.program['dist/' + retainedHost];
assert(digest.test(hostHash), 'Missing previous host script evidence');
for (const gameId of targetIDs) {
 const spec = manifest.modules[gameId];
 assert(/^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/.test(spec.version), 'Invalid target version');
 assert(digest.test(spec.files['manifest.json']), 'Missing immutable manifest digest');
 for (const [path, expected] of Object.entries(spec.files)) { safe(path); assert(digest.test(expected), 'Invalid module digest'); }
}
const plan = { release: manifest.release, sourceCommit: manifest.sourceCommit, origin, concurrency,
 clientFiles: Object.keys(manifest.delta).length, targetModules: targetIDs.length,
 packageFiles: Object.values(manifest.modules).reduce((total, spec) => total + Object.keys(spec.files).length, 0),
 retainedPointers: retainedPointers.map(value => value.gameId), retainedHost, method: 'GET' };
if (dryRun) { console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2)); process.exit(0); }

const started = Date.now();
const result = { ...plan, at: new Date().toISOString(), readOnly: true, accountsCreated: false, stakesPlaced: false,
 requestCount: 0, bytes: 0, client: [], modules: {}, preserved: { pointers: [], hostScript: null }, health: null, failures: [] };

async function checked(path, expected, { json = false, cache } = {}) {
 const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60000);
 result.requestCount++;
 try {
  const response = await fetch(origin + path, { method: 'GET', redirect: 'error', credentials: 'omit',
   headers: { 'Cache-Control': 'no-cache' }, signal: controller.signal });
  assert(response.ok, `HTTP ${response.status} at ${path}`);
  const cacheControl = response.headers.get('cache-control') || '';
  if (cache === 'pointer') assert(/\bno-store\b/.test(cacheControl), 'Active pointer cache policy changed: ' + path);
  if (cache === 'immutable') assert(/\bimmutable\b/.test(cacheControl), 'Immutable cache policy missing: ' + path);
  const checksum = createHash('sha256'), chunks = [];
  let bytes = 0;
  if (response.body) for await (const chunk of response.body) {
   bytes += chunk.byteLength;
   assert(bytes <= (json ? 65536 : 64 * 1024 * 1024), 'Unexpected response size: ' + path);
   checksum.update(chunk); if (json) chunks.push(chunk);
  }
  result.bytes += bytes;
  const sha256 = checksum.digest('hex');
  if (expected) assert(sha256 === expected, 'SHA-256 mismatch at ' + path);
  return { path, sha256, bytes, ...(json ? { data: JSON.parse(Buffer.concat(chunks).toString('utf8')) } : {}) };
 } finally { clearTimeout(timeout); controller.abort(); }
}

async function pool(tasks, stage) {
 let next = 0, completed = 0;
 const worker = async () => {
  while (next < tasks.length) {
   const task = tasks[next++];
   try { await task.run(); }
   catch (error) { result.failures.push({ stage, path: task.path, message: error instanceof Error ? error.message : 'Verification failed' }); }
   completed++;
  }
 };
 await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
 console.log(JSON.stringify({ checkpoint: stage, completed, failures: result.failures.length, bytes: result.bytes }));
}

const preliminary = Object.entries(manifest.delta).map(([path, expected]) => ({ path: path === 'index.html' ? '/' : '/' + path,
 run: async () => { result.client.push(await checked(path === 'index.html' ? '/' : '/' + path, expected)); } }));
preliminary.push({ path: '/index.html', run: async () => { await checked('/index.html', manifest.delta['index.html']); } });
for (const value of retainedPointers) preliminary.push({ path: `/game-modules/${value.gameId}/active.json`, run: async () => {
 const record = await checked(`/game-modules/${value.gameId}/active.json`, value.sha256, { cache: 'pointer' });
 result.preserved.pointers.push({ gameId: value.gameId, sha256: record.sha256, unchanged: true });
} });
preliminary.push({ path: '/' + retainedHost, run: async () => { result.preserved.hostScript = await checked('/' + retainedHost, hostHash); } });
preliminary.push({ path: '/healthz', run: async () => {
 const record = await checked('/healthz', undefined, { json: true });
 assert(record.data?.ok === true, 'Game health endpoint did not confirm ok:true'); result.health = { ok: true };
} });

for (const gameId of targetIDs) preliminary.push({ path: `/game-modules/${gameId}/active.json`, run: async () => {
 const spec = manifest.modules[gameId], root = `/game-modules/${gameId}/versions/${spec.version}/`;
 const pointer = { format: 1, gameId, manifest: root + 'manifest.json', sha256: spec.files['manifest.json'] };
 const pointerSHA = hash(Buffer.from(JSON.stringify(pointer, null, 2) + '\n'));
 const active = await checked(`/game-modules/${gameId}/active.json`, pointerSHA, { json: true, cache: 'pointer' });
 assert(JSON.stringify(active.data) === JSON.stringify(pointer), 'Unexpected target pointer content: ' + gameId);
 const metadata = await checked(pointer.manifest, pointer.sha256, { json: true, cache: 'immutable' });
 assert(metadata.data?.format === 1 && metadata.data.gameId === gameId && metadata.data.version === spec.version, 'Wrong immutable module identity: ' + gameId);
 const inventory = { ...metadata.data.files, 'manifest.json': metadata.sha256 };
 assert(JSON.stringify(Object.entries(inventory).sort()) === JSON.stringify(Object.entries(spec.files).sort()), 'Immutable file inventory differs: ' + gameId);
 result.modules[gameId] = { version: spec.version, pointerSha256: active.sha256, manifestSha256: metadata.sha256,
  expectedFiles: Object.keys(spec.files).length, verifiedFiles: 1, bytes: metadata.bytes };
} });
await pool(preliminary, 'public-release-and-retained-pointers');

if (!result.failures.length) {
 const resources = targetIDs.flatMap(gameId => {
  const spec = manifest.modules[gameId], root = `/game-modules/${gameId}/versions/${spec.version}/`;
  return Object.entries(spec.files).filter(([path]) => path !== 'manifest.json').map(([path, expected]) => ({ path: root + path,
   run: async () => {
    const record = await checked(root + path, expected, { cache: 'immutable' });
    result.modules[gameId].verifiedFiles++; result.modules[gameId].bytes += record.bytes;
   } }));
 });
 await pool(resources, 'all-seven-immutable-packages');
}
for (const [gameId, value] of Object.entries(result.modules)) {
 if (value.verifiedFiles !== value.expectedFiles) result.failures.push({ stage: 'completion', gameId, message: 'Package verification is incomplete' });
}
result.complete = result.failures.length === 0 && Object.keys(result.modules).length === targetIDs.length;
result.durationMs = Date.now() - started;
result.client.sort((a, b) => a.path.localeCompare(b.path));
result.preserved.pointers.sort((a, b) => a.gameId.localeCompare(b.gameId));
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ complete: result.complete, requests: result.requestCount, bytes: result.bytes, durationMs: result.durationMs, output, failures: result.failures }));
if (!result.complete) process.exitCode = 1;
