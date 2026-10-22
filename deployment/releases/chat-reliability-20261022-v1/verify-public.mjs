import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
const concurrency = Number(options.get('--concurrency') || 3);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('Concurrency must be between one and four');
const manifest = JSON.parse(await readFile(resolve(options.get('--manifest') || root + '/shipping/install-manifest.json'), 'utf8'));
const output = resolve(options.get('--output') || root + '/proof/public-assets.json');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const digest = /^[a-f0-9]{64}$/;
assert(manifest.release === 'chat-reliability-20261022-v1' && /^[a-f0-9]{40}$/.test(manifest.sourceCommit), 'Unexpected release or source commit');
assert(Object.keys(manifest.serverDelta).join() === 'index.js' && digest.test(manifest.serverDelta['index.js']), 'Unexpected backend delta');
assert(!manifest.modules && digest.test(manifest.delta['index.html']), 'Game publication is not part of this release');

const targets = new Map();
function target(path, sha256, kind, cache) {
 assert(path.startsWith('/') && !path.includes('..') && !path.includes('?') && !path.includes('#') && digest.test(sha256), 'Unsafe verification target');
 const existing = targets.get(path);
 assert(!existing || existing.sha256 === sha256, 'Conflicting verification target');
 if (!existing) targets.set(path, { path, sha256, kind, cache });
}
for (const [path, sha256] of Object.entries(manifest.delta)) {
 assert(path === 'index.html' || /^assets\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(path), 'Unexpected client delta');
 target(path === 'index.html' ? '/' : '/' + path, sha256, 'release-client');
}
target('/index.html', manifest.delta['index.html'], 'release-index');
const pointers = Object.entries(manifest.before.moduleFiles).filter(([path]) => /^\/opt\/royal-game-modules\/[a-z0-9-]+\/active\.json$/.test(path));
assert(pointers.length === 10 && Object.keys(manifest.before.moduleFiles).length === 268, 'Unexpected preserved module inventory');
for (const [path, sha256] of pointers) target(path.replace('/opt/royal-game-modules', '/game-modules'), sha256, 'retained-pointer', 'no-store');
const retainedScripts = ['assets/index-C718g19b.js', 'assets/index-BpF0i3G_.js', 'assets/index-r_coidVD.js'];
for (const path of retainedScripts) target('/' + path, manifest.before.program['dist/' + path], 'retained-host');
const plan = { release: manifest.release, sourceCommit: manifest.sourceCommit, origin: originURL.origin,
 method: 'GET', concurrency, clientFiles: Object.keys(manifest.delta).length, retainedPointers: pointers.length,
 retainedHostScripts: retainedScripts, requests: targets.size + 1, mediaRequests: 0 };
if (dryRun) { console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2)); process.exit(0); }

const started = Date.now();
const result = { ...plan, at: new Date().toISOString(), readOnly: true, accountsCreated: false, stakesPlaced: false,
 writesSent: 0, requestCount: 0, bytes: 0, files: [], health: null, failures: [] };
async function checked(spec) {
 const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60000);
 result.requestCount++;
 try {
  const response = await fetch(originURL.origin + spec.path, { method: 'GET', redirect: 'error', credentials: 'omit',
   headers: { 'Cache-Control': 'no-cache' }, signal: controller.signal });
  assert(response.ok, `HTTP ${response.status} at ${spec.path}`);
  const cacheControl = response.headers.get('cache-control') || '';
  if (spec.cache) assert(/\bno-store\b/.test(cacheControl), 'Active pointer cache policy changed: ' + spec.path);
  const checksum = createHash('sha256'), chunks = [];
  let bytes = 0;
  if (response.body) for await (const chunk of response.body) {
   bytes += chunk.byteLength;
   assert(bytes <= (spec.kind === 'health' ? 65536 : 16 * 1024 * 1024), 'Unexpected response size: ' + spec.path);
   checksum.update(chunk);
   if (spec.kind === 'health') chunks.push(chunk);
  }
  result.bytes += bytes;
  const sha256 = checksum.digest('hex');
  if (spec.kind === 'health') {
   assert(JSON.parse(Buffer.concat(chunks).toString('utf8'))?.ok === true, 'Health endpoint did not confirm ok:true');
   result.health = { ok: true };
  } else {
   assert(sha256 === spec.sha256, 'SHA-256 mismatch at ' + spec.path);
   result.files.push({ path: spec.path, kind: spec.kind, sha256, bytes });
  }
 } finally { clearTimeout(timeout); controller.abort(); }
}
const tasks = [...targets.values(), { path: '/healthz', kind: 'health' }];
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
 while (next < tasks.length) {
  const spec = tasks[next++];
  try { await checked(spec); }
  catch (error) { result.failures.push({ path: spec.path, message: error instanceof Error ? error.message : 'Verification failed' }); }
 }
}));
result.files.sort((a, b) => a.path.localeCompare(b.path));
result.complete = result.failures.length === 0 && result.files.length === targets.size && result.health?.ok === true;
result.durationMs = Date.now() - started;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ complete: result.complete, requests: result.requestCount, bytes: result.bytes,
 durationMs: result.durationMs, output, failures: result.failures }));
if (!result.complete) process.exitCode = 1;
