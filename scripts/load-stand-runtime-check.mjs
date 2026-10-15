import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

class CheckError extends Error { constructor(code) { super(code); this.code = code; } }
const refuse = code => { throw new CheckError(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contained = (root, path) => { const value = relative(root, path); return value !== '..' && !value.startsWith('../') && !isAbsolute(value); };
function bytes(file, maximum, root) {
  const path = realpathSync(file), info = statSync(path);
  if (!info.isFile() || info.size > maximum || root && !contained(root, path)) refuse('invalid-bounded-file');
  const data = readFileSync(path);
  if (data.length > maximum) refuse('file-size-changed');
  return data;
}
function json(file, maximum, root) { return JSON.parse(bytes(file, maximum, root)); }
function packageDirectory(require, name) {
  let path = dirname(realpathSync(require.resolve(name)));
  for (let depth = 0; depth < 12; depth++) {
    try {
      const info = json(join(path, 'package.json'), 128 * 1024);
      if (info.name === name) return { path, info };
    } catch (error) { if (error instanceof CheckError) throw error; }
    const parent = dirname(path); if (parent === path) break; path = parent;
  }
  refuse('runtime-package-manifest-not-found');
}
function execute(file, args, env, timeout, cwd) {
  return execFileSync(file, args, { env, timeout, cwd, maxBuffer: 16 * 1024,
    killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}
function verifySupplements(metadata, modules) {
  const result = new Map(), declared = metadata.runtimeSupplements ?? [];
  if (!Array.isArray(declared) || declared.length > 9) refuse('invalid-runtime-supplements');
  for (const item of declared) {
    if (!item || typeof item.package !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(item.package)
      || result.has(item.package) || !Array.isArray(item.files) || !item.files.length || item.files.length > 4096) refuse('invalid-runtime-supplement');
    const root = join(modules, item.package), files = []; let total = 0, visited = 0;
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) refuse('supplement-package-symlink');
    function walk(path = '', depth = 0) {
      if (depth > 16) refuse('supplement-depth-limit');
      for (const name of readdirSync(join(root, path)).sort()) {
        if (++visited > 4096 || name.includes('\\')) refuse('supplement-file-limit');
        const child = path ? path + '/' + name : name, file = join(root, child), info = lstatSync(file);
        if (info.isSymbolicLink()) refuse('supplement-symlink');
        if (info.isDirectory()) { walk(child, depth + 1); continue; }
        if (!info.isFile()) refuse('supplement-nonregular-file');
        const data = bytes(file, 8 * 1024 * 1024, root), magic = data.length >= 4 ? data.readUInt32BE(0) : 0;
        if (/\.(?:node|dll|so(?:\.[0-9]+)*|dylib|exe|o|a|wasm)$/i.test(child)
          || [0x7f454c46, 0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)
          || data[0] === 0x4d && data[1] === 0x5a) refuse('native-supplement-file');
        total += data.length; if (total > 32 * 1024 ** 2) refuse('supplement-size-limit');
        files.push({ path: child, bytes: data.length, sha256: hash(data) });
      }
    }
    walk(); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (item.bytes !== total || item.treeSha256 !== hash(JSON.stringify(files)) || JSON.stringify(files) !== JSON.stringify(item.files)) refuse('supplement-file-hash-mismatch');
    const installed = json(join(root, 'package.json'), 128 * 1024, root);
    if (installed.name !== item.package || installed.version !== item.version) refuse('supplement-package-version-mismatch');
    result.set(item.package, item);
  }
  return result;
}

let step = 'arguments';
try {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--load-dir', '--postgres-dir'].includes(key) || !value || value.startsWith('--') || options[key]) refuse('invalid-runtime-check-arguments');
    options[key] = value;
  }
  if (!options['--load-dir'] || !options['--postgres-dir']) refuse('load-and-postgres-directories-required');
  if (process.platform !== 'linux') refuse('linux-image-required');
  const load = realpathSync(resolve(options['--load-dir'])), postgres = realpathSync(resolve(options['--postgres-dir']));
  if (!statSync(load).isDirectory() || !statSync(postgres).isDirectory()) refuse('runtime-directories-required');
  const parent = dirname(load), ownModules = join(parent, 'node_modules');
  const require = createRequire(join(parent, 'package.json'));
  const imageModules = realpathSync('/app/node_modules');
  step = 'metadata-lock';
  const metadata = json(join(load, 'metadata.json'), 1024 * 1024, load);
  const lockBytes = bytes('/app/package-lock.json', 4 * 1024 * 1024), lock = JSON.parse(lockBytes);
  const expectedLock = metadata.baseImageLockSha256 ?? metadata.lockSha256;
  if (metadata.protocol !== 1 || expectedLock !== hash(lockBytes) || !metadata.outputs
    || !Array.isArray(metadata.runtimeRequirements) || metadata.runtimeRequirements.length > 64) refuse('metadata-lock-mismatch');
  if (metadata.baseImageLockSha256 && (metadata.sourceLockSha256 !== metadata.lockSha256 || !/^[a-f0-9]{64}$/.test(metadata.sourceLockSha256))) refuse('invalid-source-lock-metadata');
  const summary = { ok: false, platform: process.platform, architecture: process.arch, nodeVersion: process.version,
    lockSha256: expectedLock, sourceLockSha256: metadata.sourceLockSha256 ?? metadata.lockSha256,
    bundles: {}, packages: [], nativeVersions: {}, compiledHelp: {}, supplements: [],
    networkingOrDatabaseStarted: false, integrityDefinition: 'Locked metadata integrity is compared with the image lock; installed package version is checked separately' };
  step = 'bundle-hashes';
  for (const name of ['cluster.mjs', 'metrics.mjs', 'database.mjs']) {
    const expected = metadata.outputs[name], data = bytes(join(load, name), 16 * 1024 * 1024, load);
    if (!expected || expected.bytes !== data.length || expected.sha256 !== hash(data)) refuse('bundle-hash-mismatch');
    summary.bundles[name] = { bytes: data.length, sha256: expected.sha256 };
  }
  step = 'supplement-hashes';
  const supplements = verifySupplements(metadata, ownModules);
  summary.supplements = [...supplements.values()].map(item => ({ package: item.package, version: item.version, bytes: item.bytes,
    files: item.files.length, treeSha256: item.treeSha256 }));
  step = 'runtime-packages';
  const nativePackage = '@embedded-postgres/linux-' + process.arch;
  let nativePresent = false;
  for (const item of metadata.runtimeRequirements) {
    if (!item || typeof item.package !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(item.package)
      || typeof item.version !== 'string' || typeof item.integrity !== 'string') refuse('invalid-runtime-requirement');
    const binary = item.package.startsWith('@embedded-postgres/');
    if (binary && item.package !== nativePackage) continue;
    const locked = lock.packages?.['node_modules/' + item.package];
    const supplement = supplements.get(item.package);
    if (item.supplement === true) {
      if (!supplement || locked || supplement.version !== item.version || supplement.integrity !== item.integrity) refuse('supplement-requirement-mismatch');
    } else if (supplement || !locked || locked.version !== item.version || locked.integrity !== item.integrity || !binary && locked.dev === true) refuse('runtime-lock-requirement-mismatch');
    const installed = packageDirectory(require, item.package);
    if (supplement ? installed.path !== join(ownModules, item.package) : !binary && !contained(imageModules, installed.path)) refuse('production-package-outside-approved-modules');
    if (installed.info.version !== item.version) refuse('installed-package-version-mismatch');
    if (binary) {
      if (installed.path !== postgres) refuse('postgres-package-path-mismatch');
      nativePresent = true;
    }
    summary.packages.push({ package: item.package, version: installed.info.version, lockedIntegrityMatches: true, supplement: Boolean(supplement) });
  }
  if ([...supplements.keys()].some(name => !metadata.runtimeRequirements.some(item => item.package === name && item.supplement === true))) refuse('supplement-runtime-requirement-missing');
  if (!nativePresent) refuse('native-postgres-requirement-missing');
  const native = realpathSync(join(postgres, 'native'));
  if (!contained(postgres, native)) refuse('native-directory-outside-package');
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LD_LIBRARY_PATH: join(native, 'lib') };
  step = 'native-versions';
  for (const name of ['postgres', 'initdb', 'pg_ctl']) {
    const file = realpathSync(join(native, 'bin', name)), info = statSync(file);
    if (!contained(native, file) || !info.isFile() || !(info.mode & 0o111)) refuse('unsafe-native-executable');
    accessSync(file, constants.X_OK);
    const output = execute(file, ['--version'], env, 10000, postgres).trim();
    const match = output.match(new RegExp('^' + name + ' \\(PostgreSQL\\) ([0-9]+\\.[0-9]+(?:\\.[0-9]+)?)$'));
    if (!match || !metadata.bundledDatabaseLibraries?.find(item => item.package === 'embedded-postgres')?.version.startsWith(match[1] + '.')) refuse('native-postgres-version-mismatch');
    summary.nativeVersions[name] = match[1];
  }
  step = 'compiled-help';
  for (const name of ['cluster.mjs', 'database.mjs']) {
    const output = execute(process.execPath, [join(load, name), '--help'], env, 20000, '/app');
    if (!output.trim()) refuse('compiled-help-empty');
    summary.compiledHelp[name] = { passed: true };
  }
  summary.ok = true;
  console.log(JSON.stringify(summary));
} catch (error) {
  console.log(JSON.stringify({ ok: false, step, error: error instanceof CheckError ? error.code : 'bounded-runtime-check-failed' }));
  process.exitCode = 1;
}
