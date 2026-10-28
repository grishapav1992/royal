import { readFile, mkdir, writeFile, copyFile, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyRelease, assertClean } from '../../../scripts/release.mjs';

export const scope = new Set(['server/crypto/store.ts', 'server/payments/app.ts', 'server/payments/index.ts',
  'server/payments/runtime.ts', 'server/payments/telegram-provider.ts', 'server/payments/telegram-stars.ts', 'src/shared/cryptoWallet.ts']);
export const hash = value => createHash('sha256').update(value).digest('hex');
export function dependencies(lock, metadata) {
  const result = {};
  function visit(name, parent = '') {
    let folder = parent, key;
    for (;;) {
      key = (folder ? folder + '/' : '') + 'node_modules/' + name;
      if (lock.packages[key]) break;
      if (!folder) throw Error('Missing locked payment dependency: ' + name);
      const at = folder.lastIndexOf('/node_modules/');
      folder = at < 0 ? '' : folder.slice(0, at);
    }
    if (result[key]) return;
    const row = lock.packages[key];
    result[key] = row.version;
    for (const child of Object.keys(row.dependencies ?? {})) visit(child, key);
  }
  for (const output of Object.values(metadata.outputs)) for (const item of output.imports) {
    if (item.external && !item.path.startsWith('node:')) visit(item.path);
  }
  return result;
}

export async function prepare(root, beforeFile, output) {
  assertClean(root);
  const release = await verifyRelease(root);
  const receipt = JSON.parse(await readFile(resolve(root, 'module-build/release-github.json')));
  if (!release.githubVerified || receipt.sourceCommit !== release.sourceCommit) throw Error('Verify the exact release against GitHub first');
  const before = JSON.parse(await readFile(beforeFile));
  const metadata = JSON.parse(await readFile(resolve(root, 'dist-server/payments-meta.json')));
  const inputs = {}, changed = {};
  await mkdir(output, { recursive: false });
  for (const name of Object.keys(metadata.inputs)) {
    if (!/^(server|src)\/[A-Za-z0-9_./-]+$/.test(name) || posix.normalize(name) !== name) throw Error('Unsafe payment input');
    const bytes = await readFile(resolve(root, name));
    if (bytes.includes(Buffer.from('\r'))) throw Error('Payment inputs must use canonical LF bytes');
    inputs[name] = hash(bytes);
    if (before.sourceLF[name] !== inputs[name]) {
      if (!scope.has(name)) throw Error('Unrelated payment source changed: ' + name);
      changed[name] = inputs[name];
      const path = resolve(output, 'source', name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
  }
  const locked = dependencies(JSON.parse(await readFile(resolve(root, 'package-lock.json'))), metadata);
  const dependencyUpdates = Object.entries(locked).filter(([name, version]) => before.dependencies[name] !== version).map(([name]) => name);
  if (dependencyUpdates.some(name => !['node_modules/body-parser', 'node_modules/qs'].includes(name))) throw Error('Unreviewed payment dependency update');
  const dependencyFiles = {};
  async function copyDependency(name) {
    const source = resolve(root, name), stat = await lstat(source);
    if (stat.isSymbolicLink()) throw Error('Dependency symlink rejected');
    if (stat.isDirectory()) for (const child of await readdir(source)) await copyDependency(name + '/' + child);
    else if (stat.isFile()) {
      const bytes = await readFile(source);
      dependencyFiles[name] = hash(bytes);
      await mkdir(dirname(resolve(output, 'dependencies', name)), { recursive: true });
      await writeFile(resolve(output, 'dependencies', name), bytes);
    } else throw Error('Unexpected dependency file type');
  }
  for (const name of dependencyUpdates) {
    await copyDependency(name);
    for (const old of Object.keys(before.programs['royal-payments-1']).filter(path => path.startsWith(name + '/'))) {
      if (!(old in dependencyFiles)) throw Error('Dependency update would retain an obsolete file: ' + old);
    }
  }
  const lockBytes = await readFile(resolve(root, 'package-lock.json'));
  await writeFile(resolve(output, 'package-lock.json'), lockBytes);
  await copyFile(resolve(root, 'dist-server/payments.js'), resolve(output, 'payments.js'));
  await copyFile(resolve(root, 'deployment/Caddyfile'), resolve(output, 'Caddyfile'));
  const helpers = resolve(root, 'deployment/releases/nowpayments-sandbox-20261027-v1');
  const files = {
    'install.py': resolve(root, 'deployment/releases/telegram-stars-20261029-v1/install.py'),
    ...Object.fromEntries(['financial_gate.py', 'quiesce.cjs', 'runtime-inventory.cjs'].map(name => [name, resolve(helpers, name)])),
    'release-manifest.json': resolve(root, 'module-build/release-manifest.json'),
    'release-github.json': resolve(root, 'module-build/release-github.json'),
  };
  for (const [name, path] of Object.entries(files)) await copyFile(path, resolve(output, name));
  const manifest = { format: 1, release: 'telegram-stars-20261029-v1', sourceCommit: release.sourceCommit,
    before, inputs, changed, dependencies: locked, dependencyUpdates, dependencyFiles, lockHash: hash(lockBytes),
    helpers: Object.fromEntries(await Promise.all(['install.py', 'financial_gate.py', 'quiesce.cjs', 'runtime-inventory.cjs']
      .map(async name => [name, hash(await readFile(resolve(output, name)))]))) };
  await writeFile(resolve(output, 'install-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { sourceCommit: release.sourceCommit, changedSources: Object.keys(changed), dependencies: Object.keys(locked).length };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4) throw Error('Specify the reviewed snapshot and a new task-owned payload directory');
  console.log(JSON.stringify(await prepare(process.cwd(), resolve(process.argv[2]), resolve(process.argv[3]))));
}
