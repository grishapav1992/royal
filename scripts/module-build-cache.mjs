import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const media = /\.(?:webp|png|jpe?g|avif|gif|svg|mp4|mp3|ogg|wav|m4a|json|woff2?|ttf|otf)$/;

export async function regularPath(root, name) {
  if (!name || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..')
      || relative(root, resolve(root, name)).replaceAll('\\', '/') !== name) throw Error('Unsafe build path: ' + name);
  let path = resolve(root, name);
  while (path !== root) {
    if ((await lstat(path)).isSymbolicLink()) throw Error('Build symlink rejected: ' + name);
    path = dirname(path);
  }
  return resolve(root, name);
}

export async function inventory(root, prefix = '') {
  const result = {};
  for (const item of (await readdir(resolve(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + item.name;
    if (item.isSymbolicLink()) throw Error('Build output symlink rejected: ' + name);
    if (item.isDirectory()) Object.assign(result, await inventory(root, name + '/'));
    else if (item.isFile()) result[name] = digest(await readFile(resolve(root, name)));
    else throw Error('Nonregular build output: ' + name);
  }
  return result;
}

// Each invocation has its own memo. Nothing survives a source edit between builds.
export function moduleFingerprinter(root, toolchain) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };
  const file = name => once('file:' + name, async () => {
    try { return digest(await readFile(await regularPath(root, name))); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  const resources = name => once('media:' + name, async () => {
    let path;
    try { path = await regularPath(root, name); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const info = await lstat(path);
    if (info.isFile()) return media.test(name) ? await file(name) : null;
    if (!info.isDirectory()) throw Error('Nonregular module media: ' + name);
    const rows = {};
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.isSymbolicLink()) throw Error('Module media symlink rejected: ' + name + '/' + item.name);
      if (item.isDirectory() || media.test(item.name) && /^[a-zA-Z0-9_.-]+$/.test(item.name)) rows[item.name] = await resources(name + '/' + item.name);
    }
    return rows;
  });
  return async (config, contract, inputs) => {
    const files = new Set(['package.json', 'package-lock.json', 'tsconfig.json',
      'scripts/build-game-module.mjs', 'scripts/module-build-cache.mjs',
      'src/modules/GameModuleCatalog.ts', `games/${contract.slug}/package.json`,
      `games/${contract.slug}/tsconfig.json`, ...inputs]);
    const directories = new Set();
    for (const name of inputs) {
      let parent = dirname(name);
      while (parent !== '.') {
        directories.add(parent);
        files.add(parent + '/package.json');
        files.add(parent + '/tsconfig.json');
        parent = dirname(parent);
      }
    }
    const hashes = {};
    for (const name of [...files].sort()) hashes[name] = await file(name);
    const entries = {};
    // Catch new import-resolution candidates (for example foo.ts shadowing foo/index.ts).
    for (const name of [...directories].sort()) entries[name] = await once('dir:' + name, async () => {
      try { return (await readdir(await regularPath(root, name))).sort(); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    });
    const assets = {};
    for (const name of [...(config.assetRoots ?? []), ...(config.assetFiles ?? [])].sort()) {
      assets[name] = await resources('public/assets/' + name);
    }
    return digest(JSON.stringify({ format: 1, toolchain, config, contract, hashes, entries, assets }));
  };
}

export async function cachedModule(root, config, contract, fingerprint) {
  let proof;
  try { proof = JSON.parse(await readFile(resolve(root, 'module-build', contract.slug + '-proof.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  if (proof.cache?.format !== 1 || !proof.sourceFiles || proof.gameId !== contract.gameId) return null;
  if (await fingerprint(config, contract, Object.keys(proof.sourceFiles)) !== proof.cache.fingerprint) return null;
  if (!/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(proof.version)) throw Error('Invalid cached module version');
  const name = `module-dist/${contract.gameId}/versions/${proof.version}`;
  let folder;
  try { folder = await regularPath(root, name); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const actual = await inventory(folder);
  if (!proof.cache.outputs || Object.keys(actual).length !== Object.keys(proof.cache.outputs).length
      || Object.entries(actual).some(([name, hash]) => proof.cache.outputs[name] !== hash)) {
    throw Error('Cached immutable module is damaged: ' + contract.slug);
  }
  return { proof, folder, pointer: { format: 1, gameId: contract.gameId,
    manifest: `/game-modules/${contract.gameId}/versions/${proof.version}/manifest.json`,
    sha256: actual['manifest.json'] } };
}
