import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile, rename, rm, unlink, rmdir, statfs } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { digest, inventory, regularPath, verifyCachedModule } from './module-build-cache.mjs';

const execute = promisify(execFile);
const magic = Buffer.from('ROYAL_MODULE_CACHE_V1\n');
const maxHeader = 1024 ** 2, maxEntry = 66 * 1024 ** 2;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const resource = name => typeof name === 'string' && /^[a-zA-Z0-9_./-]+$/.test(name)
  && !name.startsWith('/') && !name.split('/').some(part => !part || part === '.' || part === '..');

async function plainDirectory(path, create = false) {
  // Check existing ancestors before mkdir, including Windows junctions.
  for (let part = resolve(path); ; part = dirname(part)) {
    try { const info = await lstat(part); if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Shared cache directory symlink or file rejected'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(part) === part) break;
  }
  if (create) await mkdir(path, { recursive: true });
}

export async function sharedModuleCache(root, env = process.env) {
  if (env.ROYAL_SHARED_MODULE_CACHE === '0' || (env.CI && !['0', 'false'].includes(env.CI) && !env.ROYAL_SHARED_MODULE_CACHE_DIR)) return null;
  let path = env.ROYAL_SHARED_MODULE_CACHE_DIR;
  if (!path) {
    try {
      const result = await execute('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root });
      path = resolve(result.stdout.trim(), 'royal-module-cache', 'v1');
    } catch { return null; } // Source archives and unavailable Git still build normally.
  }
  const maxBytes = env.ROYAL_SHARED_MODULE_CACHE_MAX_BYTES === undefined ? 2 * 1024 ** 3 : Number(env.ROYAL_SHARED_MODULE_CACHE_MAX_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw Error('Invalid shared module cache size limit');
  return { root: resolve(path), maxBytes, minFreeBytes: 10 * 1024 ** 3 };
}

function slot(cache, contract) {
  if (!slugPattern.test(contract.slug) || !slugPattern.test(contract.gameId)) throw Error('Invalid shared cache game identity');
  return resolve(cache.root, contract.slug + '.cache');
}

function pack(contract, proof, outputs) {
  if (proof.cache?.format !== 1 || proof.gameId !== contract.gameId) throw Error('Shared cache requires an ordinary verified package');
  const names = [...outputs.keys()].sort();
  if (!names.includes('manifest.json') || names.length > 257 || names.some(name => !resource(name))) throw Error('Invalid shared cache output inventory');
  const actual = Object.fromEntries(names.map(name => [name, digest(outputs.get(name))]));
  if (JSON.stringify(actual) !== JSON.stringify(Object.fromEntries(Object.entries(proof.cache.outputs).sort()))) throw Error('Shared cache source package changed');
  const header = Buffer.from(JSON.stringify({ format: 1, slug: contract.slug, proof, resources: names.map(name => ({ name, bytes: outputs.get(name).length })) }));
  if (header.length > maxHeader) throw Error('Shared cache metadata exceeds limit');
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  const bytes = Buffer.concat([magic, length, header, ...names.map(name => outputs.get(name))]);
  if (bytes.length > maxEntry) throw Error('Shared cache package exceeds limit');
  return bytes;
}

function unpack(bytes, contract) {
  const damaged = () => { throw Error('Shared immutable module cache is damaged: ' + contract.slug); };
  if (bytes.length > maxEntry || bytes.length < magic.length + 4 || !bytes.subarray(0, magic.length).equals(magic)) damaged();
  const length = bytes.readUInt32BE(magic.length), start = magic.length + 4;
  if (length > maxHeader || length === 0 || start + length > bytes.length) damaged();
  let header;
  try { header = JSON.parse(bytes.subarray(start, start + length)); } catch { damaged(); }
  if (header.format !== 1 || header.slug !== contract.slug || header.proof?.gameId !== contract.gameId
      || !Array.isArray(header.resources) || header.resources.length < 1 || header.resources.length > 257) damaged();
  let offset = start + length;
  const outputs = new Map();
  for (const entry of header.resources) {
    if (!resource(entry.name) || outputs.has(entry.name) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || offset + entry.bytes > bytes.length) damaged();
    outputs.set(entry.name, bytes.subarray(offset, offset + entry.bytes)); offset += entry.bytes;
  }
  if (offset !== bytes.length || !outputs.has('manifest.json')) damaged();
  return { proof: header.proof, outputs };
}

async function atomicRename(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 4) throw error;
      await delay(50 * 2 ** attempt);
    }
  }
}

async function outputDirectory(root, name) {
  let path = root;
  for (const part of name.split('/')) {
    if (!resource(part)) throw Error('Unsafe restored module path');
    path = resolve(path, part);
    try { await mkdir(path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Restored module directory symlink rejected');
  }
  return path;
}

async function atomicProof(root, contract, proof) {
  const directory = await outputDirectory(root, 'module-build');
  const target = resolve(directory, contract.slug + '-proof.json');
  try { if ((await lstat(target)).isSymbolicLink()) throw Error('Module proof symlink rejected'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = target + '.pending-' + randomUUID();
  try { await writeFile(temporary, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' }); await atomicRename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}

async function restore(root, cache, config, contract, fingerprint) {
  if (!cache) return { hit: null, reason: 'disabled' };
  await plainDirectory(cache.root);
  let bytes;
  try {
    const path = slot(cache, contract), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxEntry) throw Error('Invalid shared cache entry');
    bytes = await readFile(path);
  } catch (error) { if (error.code === 'ENOENT') return { hit: null, reason: 'missing' }; throw error; }
  const entry = unpack(bytes, contract);
  const hit = await verifyCachedModule(root, config, contract, fingerprint, entry.proof,
    async () => Object.fromEntries([...entry.outputs].map(([name, content]) => [name, digest(content)])));
  if (!hit) return { hit: null, reason: 'inputs-changed' };
  const versions = await outputDirectory(root, `module-dist/${contract.gameId}/versions`);
  const destination = resolve(versions, hit.proof.version);
  let existing;
  try { existing = await lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    const actual = await inventory(await regularPath(root, `module-dist/${contract.gameId}/versions/${hit.proof.version}`));
    if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(hit.outputs).sort())) throw Error('Immutable module version collision during shared cache restore');
    await atomicProof(root, contract, hit.proof);
    return { hit: { ...hit, folder: destination }, reason: 'shared-hit', bytes: bytes.length };
  }
  const temporary = resolve(versions, '.pending-' + randomUUID());
  await mkdir(temporary);
  try {
    for (const [name, content] of entry.outputs) {
      const parent = relative(temporary, dirname(resolve(temporary, name))).replaceAll('\\', '/');
      if (parent) await outputDirectory(temporary, parent);
      await writeFile(resolve(temporary, name), content, { flag: 'wx' });
    }
    try { await atomicRename(temporary, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      await regularPath(root, `module-dist/${contract.gameId}/versions/${hit.proof.version}`);
    }
    const actual = await inventory(await regularPath(root, `module-dist/${contract.gameId}/versions/${hit.proof.version}`));
    if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(hit.outputs).sort())) throw Error('Immutable module version collision during shared cache restore');
    await atomicProof(root, contract, hit.proof);
    return { hit: { ...hit, folder: destination }, reason: 'shared-hit', bytes: bytes.length };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function store(cache, contract, proof, outputs) {
  if (!cache) return { status: 'disabled' };
  await plainDirectory(cache.root, true);
  const target = slot(cache, contract), lock = resolve(cache.root, '.write-lock');
  const alreadyPresent = async () => {
   try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxEntry) throw Error('Invalid shared cache entry');
    const existingBytes = await readFile(target), existing = unpack(existingBytes, contract);
    if (existing.proof.cache?.fingerprint === proof.cache.fingerprint && !isDeepStrictEqual(existing.proof, proof)) throw Error('Shared immutable module fingerprint collision: ' + contract.slug);
    if (isDeepStrictEqual(existing.proof, proof)) {
      const actual = Object.fromEntries([...existing.outputs].map(([name, content]) => [name, digest(content)]));
      if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(proof.cache.outputs).sort())) throw Error('Shared immutable module cache is damaged: ' + contract.slug);
      return { status: 'already-present', bytes: existingBytes.length };
    }
   } catch (error) { if (error.code !== 'ENOENT') throw error; }
   return null;
  };
  const existing = await alreadyPresent();
  if (existing) return existing;
  const bytes = pack(contract, proof, typeof outputs === 'function' ? await outputs() : outputs);
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') return { status: 'write-busy' }; throw error; }
  const temporary = resolve(cache.root, '.pending-' + randomUUID());
  try {
    await writeFile(resolve(lock, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), purpose: 'Atomic shared module cache write', cleanupCondition: 'Remove after owner exits' }), { flag: 'wx' });
    const current = await alreadyPresent();
    if (current) return current;
    let used = 0, previousSize = 0;
    for (const item of await readdir(cache.root, { withFileTypes: true })) {
      if (item.name === '.write-lock') continue;
      if (!item.isFile() || item.isSymbolicLink()) throw Error('Unexpected shared cache entry');
      const path = resolve(cache.root, item.name), info = await lstat(path);
      used += info.size;
      if (path === target) previousSize = info.size;
    }
    if (used - previousSize + bytes.length > cache.maxBytes) return { status: 'capacity' };
    const disk = await statfs(cache.root);
    if (disk.bavail * disk.bsize - bytes.length < cache.minFreeBytes) return { status: 'disk-reserve' };
    if (previousSize === bytes.length && digest(await readFile(target)) === digest(bytes)) return { status: 'already-present', bytes: bytes.length };
    await writeFile(temporary, bytes, { flag: 'wx' });
    await atomicRename(temporary, target);
    return { status: 'stored', bytes: bytes.length };
  } finally {
    await rm(temporary, { force: true });
    await rm(resolve(lock, 'owner.json'), { force: true });
    await rmdir(lock);
  }
}

const unavailable = error => ['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(error.code);
export async function restoreSharedModule(...args) {
  try { return await restore(...args); }
  catch (error) { if (unavailable(error)) return { hit: null, reason: 'shared-unavailable' }; throw error; }
}
export async function storeSharedModule(...args) {
  try { return await store(...args); }
  catch (error) { if (unavailable(error)) return { status: 'unavailable' }; throw error; }
}

export async function moduleCacheOutputs(folder, proof) {
  return new Map(await Promise.all(Object.keys(proof.cache.outputs).map(async name => [name, await readFile(await regularPath(folder, name))])));
}
