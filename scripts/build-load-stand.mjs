import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1];
  if (!['--out-dir', '--runtime-lock'].includes(key) || !value || value.startsWith('--') || options[key]) throw new Error('Usage: node scripts/build-load-stand.mjs [--out-dir PATH] [--runtime-lock PATH]');
  options[key] = value;
}
const output = resolve(options['--out-dir'] ?? resolve(project, 'dist-load'));
const require = createRequire(import.meta.url);
const hash = data => createHash('sha256').update(data).digest('hex');
const lockBytes = await readFile(resolve(project, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
const baseBytes = options['--runtime-lock'] ? await readFile(resolve(options['--runtime-lock'])) : undefined;
const base = baseBytes ? JSON.parse(baseBytes) : undefined;
const allowedSupplements = new Set(['@colyseus/redis-driver', '@colyseus/redis-presence', '@ioredis/commands',
  'cluster-key-slot', 'denque', 'ioredis', 'redis-errors', 'redis-parser', 'standard-as-callback']);
const supplements = [];
const purpose = 'Prebuilt isolated WebSocket test stand, no SDK generators on the server';
const metricsGuard = "if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {";

function pureJavaScriptFile(path, data) {
  const magic = data.length >= 4 ? data.readUInt32BE(0) : 0;
  if (/\.(?:node|dll|so(?:\.[0-9]+)*|dylib|exe|o|a|wasm)$/i.test(path)
    || [0x7f454c46, 0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)
    || data[0] === 0x4d && data[1] === 0x5a) throw new Error('Native supplement file refused: ' + path);
}
async function copySupplement(name, item) {
  const source = join(project, 'node_modules', name), destination = join(output, 'supplements', 'node_modules', name);
  if (!(await lstat(source)).isDirectory()) throw new Error('Supplement package must be a regular directory: ' + name);
  const installed = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (installed.name !== name || installed.version !== item.version) throw new Error('Installed supplement version mismatch: ' + name);
  const files = []; let totalBytes = 0;
  async function walk(path = '') {
    for (const entry of (await readdir(join(source, path))).sort()) {
      const child = path ? path + '/' + entry : entry, file = join(source, child), info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('Supplement symlink refused: ' + name + '/' + child);
      if (info.isDirectory()) { await walk(child); continue; }
      if (!info.isFile() || info.size > 8 * 1024 ** 2 || files.length >= 4096) throw new Error('Supplement file limit: ' + name);
      const data = await readFile(file); pureJavaScriptFile(child, data); totalBytes += data.length;
      if (totalBytes > 32 * 1024 ** 2) throw new Error('Supplement package size limit: ' + name);
      await mkdir(dirname(join(destination, child)), { recursive: true });
      await writeFile(join(destination, child), data, { mode: 0o644 });
      files.push({ path: child, bytes: data.length, sha256: hash(data) });
    }
  }
  await walk(); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { package: name, version: item.version, integrity: item.integrity, files, bytes: totalBytes,
    treeSha256: hash(JSON.stringify(files)) };
}
async function refreshOwnedSupplements() {
  const directory = join(output, 'supplements');
  let existing;
  try { existing = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Existing supplement directory must not be a symlink');
  const previous = JSON.parse(await readFile(join(output, 'metadata.json'), 'utf8'));
  if (previous.purpose !== purpose || !Array.isArray(previous.runtimeSupplements) || !previous.runtimeSupplements.length) throw new Error('Refusing to erase undeclared supplement directory');
  const owned = new Map();
  for (const item of previous.runtimeSupplements) {
    if (!allowedSupplements.has(item.package) || !Array.isArray(item.files)) throw new Error('Unowned previous supplement package');
    for (const file of item.files) {
      if (typeof file.path !== 'string' || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid previous supplement file path');
      owned.set('node_modules/' + item.package + '/' + file.path, file);
    }
  }
  async function verify(path = '') {
    for (const name of await readdir(join(directory, path))) {
      const child = path ? path + '/' + name : name, file = join(directory, child), info = await lstat(file);
      if (info.isDirectory()) {
        if (![...owned.keys()].some(key => key.startsWith(child + '/'))) throw new Error('Unowned previous supplement directory');
        await verify(child); continue;
      }
      const expected = owned.get(child);
      if (!info.isFile() || !expected || info.size !== expected.bytes || hash(await readFile(file)) !== expected.sha256) throw new Error('Changed or unowned previous supplement file');
      owned.delete(child);
    }
  }
  await verify(); if (owned.size) throw new Error('Previous supplement files are missing');
  await rm(directory, { recursive: true });
}

function plugins(name) {
  return [{ name: 'stand-library-entrypoints', setup(context) {
    if (name !== 'metrics') context.onLoad({ filter: /[/\\]load-server-metrics\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      if (source.split(metricsGuard).length !== 2) throw new Error('Metrics entrypoint guard changed; review the standalone build');
      return { contents: source.replace(metricsGuard, 'if (false) {'), loader: 'ts', resolveDir: dirname(path) };
    });
    if (name === 'database') context.onResolve({ filter: /^(?:embedded-postgres|async-exit-hook)$/ }, ({ path }) => ({ path: require.resolve(path) }));
  } }];
}

await mkdir(output, { recursive: true });
if (!(await lstat(output)).isDirectory() || await realpath(output) !== output) throw new Error('Build output directory must not resolve through symlinks');
if (base) {
  if (!base.packages || !lock.packages) throw new Error('Runtime lock package map required');
  const missing = [];
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path.startsWith('node_modules/') || item.dev === true) continue;
    const installed = base.packages[path];
    if (installed) {
      if (item.version !== installed.version || item.integrity !== installed.integrity || installed.dev === true) throw new Error('Common production runtime lock mismatch: ' + path);
    } else {
      const name = path.slice('node_modules/'.length);
      if (!allowedSupplements.has(name) || !item.version || !item.integrity) throw new Error('Unapproved missing production runtime package: ' + name);
      missing.push([name, item]);
    }
  }
  await refreshOwnedSupplements();
  for (const [name, item] of missing.sort(([a], [b]) => a.localeCompare(b))) supplements.push(await copySupplement(name, item));
}
const outputs = {}, inputs = new Map(), requirements = new Map();
for (const [name, entry] of [['cluster', 'load-websocket-cluster.ts'], ['metrics', 'load-server-metrics.ts'], ['database', 'load-stand-database.ts']]) {
  const outfile = resolve(output, name + '.mjs');
  const result = await build({ absWorkingDir: project, entryPoints: [resolve(project, 'scripts', entry)], outfile,
    bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external', metafile: true,
    plugins: plugins(name), external: ['@embedded-postgres/*'],
    banner: { js: "import { createRequire as standCreateRequire } from 'node:module'; const require = standCreateRequire(import.meta.url);" },
    logLevel: 'warning' });
  const bytes = await readFile(outfile);
  const external = [...new Set(Object.values(result.metafile.outputs).flatMap(item => item.imports.filter(value => value.external).map(value => value.path)))].sort();
  for (const dependency of external) {
    if (dependency.startsWith('node:') || require('node:module').isBuiltin(dependency)) continue;
    const packageName = dependency.startsWith('@') ? dependency.split('/').slice(0, 2).join('/') : dependency.split('/')[0];
    const binary = packageName.startsWith('@embedded-postgres/');
    const item = lock.packages['node_modules/' + packageName];
    if (!item?.version || !item.integrity) throw new Error('Missing locked runtime dependency: ' + packageName);
    if (!binary && item.dev === true) throw new Error('Non-production runtime dependency: ' + packageName);
    requirements.set(packageName, { package: packageName, version: item.version, integrity: item.integrity,
      provision: binary ? 'offline platform binary package, verified against package-lock.json' : 'production node_modules from the exact immutable application image' });
  }
  for (const input of Object.keys(result.metafile.inputs)) inputs.set(input, hash(await readFile(resolve(project, input))));
  outputs[name + '.mjs'] = { bytes: bytes.length, sha256: hash(bytes), externalImports: external };
}
for (const item of supplements) requirements.set(item.package, { package: item.package, version: item.version, integrity: item.integrity,
  supplement: true, provision: 'offline pure JavaScript supplement, every copied file SHA256 verified' });
const metadata = { protocol: 1, purpose,
  target: 'node22', format: 'esm', packages: 'external', lockSha256: hash(lockBytes),
  ...(baseBytes ? { sourceLockSha256: hash(lockBytes), baseImageLockSha256: hash(baseBytes), runtimeSupplements: supplements } : {}),
  bundledDatabaseLibraries: ['embedded-postgres', 'async-exit-hook'].map(name => ({ package: name, version: lock.packages['node_modules/' + name].version })),
  outputs, inputs: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))),
  runtimeRequirements: [...requirements.values()].sort((a, b) => a.package.localeCompare(b.package)),
  notes: ['No npm install, network fetch, production credentials or server startup occurs during this build.',
    'Copy only the appropriate @embedded-postgres platform package into runtime node_modules. The build leaves native PostgreSQL binaries external.',
    'Start server-only cluster mode with --stand-manifest and --metrics-script metrics.mjs; run SDK generators on the client machine.',
    'The immutable application image must also provide the compatible production dependencies required by the separately frozen server bundle.'] };
await writeFile(resolve(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ output: relative(project, output), lockSha256: metadata.lockSha256,
  ...(baseBytes ? { baseImageLockSha256: metadata.baseImageLockSha256, supplements: supplements.map(item => ({ package: item.package, version: item.version, bytes: item.bytes, files: item.files.length, treeSha256: item.treeSha256 })) } : {}),
  outputs: Object.fromEntries(Object.entries(outputs).map(([name, item]) => [name, { bytes: item.bytes, sha256: item.sha256 }])) }, null, 2));
