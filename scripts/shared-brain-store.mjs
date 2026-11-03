import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';

export const ARTIFACT_NAMES = Object.freeze(['graph.json', 'project-brain.json', 'PROJECT_BRAIN.md', 'production.json']);
const caps = { 'graph.json': 96 * 1024 * 1024, 'project-brain.json': 8 * 1024 * 1024,
  'PROJECT_BRAIN.md': 1024 * 1024, 'production.json': 8 * 1024 * 1024 };
const HASH = /^[a-f0-9]{64}$/;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);

export class SharedBrainError extends Error {
  constructor(code, message, exitCode = 2) { super(message); this.name = 'SharedBrainError'; this.code = code; this.exitCode = exitCode; }
}
const fail = (code, message) => { throw new SharedBrainError(code, message); };

async function checkedDirectory(path, create = false) {
  const full = resolve(path), base = parse(full).root;
  let current = base;
  for (const part of full.slice(base.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) throw error;
      await mkdir(current, { mode: 0o700 }); info = await lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe_store', 'The shared graph directory must not contain symbolic links.');
  }
  if (await realpath(full) !== full) fail('unsafe_store', 'The shared graph directory must be canonical.');
  return full;
}

async function regularFile(path, maxBytes, keepOpen = false) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) fail('graph_integrity', 'A shared graph file has an invalid type or size.');
    const body = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < body.length) {
      const { bytesRead } = await handle.read(body, count, body.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await handle.stat();
    if (count !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail('graph_integrity', 'A shared graph file changed during reading.');
    const data = body.subarray(0, count);
    if (!keepOpen) await handle.close();
    return { data, handle: keepOpen ? handle : null };
  } catch (error) { await handle.close(); throw error; }
}

async function readJson(path, maxBytes, optional = false) {
  try { return JSON.parse((await regularFile(path, maxBytes)).data.toString('utf8')); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) fail('graph_integrity', 'A shared graph metadata file is invalid.');
    throw error;
  }
}

async function writeFile(path, data) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}

async function atomicJson(path, value) {
  const temporary = join(dirname(path), '.' + basename(path) + '-' + randomUUID());
  try { await writeFile(temporary, canonical(value) + '\n'); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

async function locked(root, callback) {
  await checkedDirectory(root, true);
  const path = join(root, '.publish.lock');
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(path), body = await readJson(path, 512);
    if (!Number.isSafeInteger(body?.pid) || body.pid < 1) fail('store_locked', 'The shared graph publication lock requires review.');
    try { process.kill(body.pid, 0); fail('store_locked', 'Another shared graph publication is running.'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    const current = await lstat(path);
    if (current.ino !== info.ino || current.dev !== info.dev) fail('store_locked', 'The shared graph lock changed.');
    await rm(path); lock = await open(path, 'wx', 0o600);
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid })); return await callback(); }
  finally { await lock.close(); await rm(path, { force: true }); }
}

export function validateProduction(production) {
  if (!production || production.schemaVersion !== 1 || production.scope !== 'production'
    || !HASH.test(production.runtimeFingerprint) || !RELEASE.test(production.releaseId)
    || typeof production.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(production.verifiedAt)
    || !Number.isFinite(Date.parse(production.verifiedAt))
    || !Array.isArray(production.components) || production.components.length < 1 || production.components.length > 512) {
    fail('invalid_production', 'The production provenance manifest is invalid.');
  }
  for (const component of production.components) {
    if (!component || !['host', 'backend', 'module', 'knowledge'].includes(component.scope)
      || (component.id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(component.id))
      || (component.scope === 'module' && !/^[a-z0-9][a-z0-9-]{0,127}$/.test(component.gameId))
      || ['version', 'packageVersion'].some(key => component[key] !== undefined && !RELEASE.test(component[key]))
      || (component.coverage !== undefined && !(component.scope === 'knowledge'
        ? ['complete', 'partial', 'source-reviewed'] : ['complete', 'partial']).includes(component.coverage))
      || (component.sourceCommit !== undefined && !/^[a-f0-9]{40}$/.test(component.sourceCommit))
      || (component.projectionHash !== undefined && !HASH.test(component.projectionHash))) {
      fail('invalid_production', 'A production component has invalid provenance.');
    }
    if (component.sources !== undefined && (!Array.isArray(component.sources)
      || component.sources.some(source => !source || typeof source !== 'object'
        || (source.origin !== null && source.origin !== undefined && typeof source.origin !== 'object')))) {
      fail('invalid_production', 'A production component source inventory is invalid.');
    }
  }
  const encoded = Buffer.from(canonical(production) + '\n');
  if (encoded.length > caps['production.json']) fail('invalid_production', 'The production provenance manifest is too large.');
  return production;
}

function provenanceOf(snapshotId, production) {
  const components = production.components.map(component => {
    const sources = Array.isArray(component.sources) ? component.sources : [];
    const knowledgeCommit = component.scope === 'knowledge' && component.sourceCommit;
    const commits = [...new Set([knowledgeCommit, ...sources.map(source => source.origin?.commit)]
      .filter(value => /^[a-f0-9]{40}$/.test(value)))].sort();
    const unmappedSources = sources.filter(source => !source.origin && !knowledgeCommit).length;
    return { id: component.id, scope: component.scope, gameId: component.gameId,
      packageVersion: component.packageVersion ?? component.version, coverage: component.coverage ?? 'partial',
      sourceCommit: component.sourceCommit, projectionHash: component.projectionHash,
      sourceFileCount: sources.length, sourceCommits: commits, unmappedSources,
      mixedSources: commits.length > 1 || unmappedSources > 0 || sources.some(source => source.origin?.patches?.length) };
  });
  return { scope: 'production', snapshotId, runtimeFingerprint: production.runtimeFingerprint,
    releaseId: production.releaseId, verifiedAt: production.verifiedAt, components };
}

async function desiredTarget(root) {
  const receiptDirectory = join(root, 'receipts');
  let receipt = null;
  try { await checkedDirectory(receiptDirectory); receipt = await readJson(join(receiptDirectory, 'latest.json'), 16 * 1024 * 1024, true); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (receipt && receipt.releaseId === undefined && receipt.release !== undefined) receipt = { ...receipt, releaseId: receipt.release };
  const target = await readJson(join(root, 'target.json'), 8192, true);
  for (const item of [receipt, target]) if (item && (!HASH.test(item.runtimeFingerprint) || !RELEASE.test(item.releaseId))) {
    fail('graph_integrity', 'The desired production graph target is invalid.');
  }
  return { desired: receipt ?? target, receipt, target };
}

async function loadSnapshot(root, snapshotId, retainGraph = true) {
  if (!HASH.test(snapshotId)) fail('graph_integrity', 'The active snapshot identifier is invalid.');
  const directory = await checkedDirectory(join(root, 'snapshots', snapshotId));
  const manifest = await readJson(join(directory, 'manifest.json'), 64 * 1024);
  if (manifest?.schemaVersion !== 1 || manifest.snapshotId !== snapshotId || !HASH.test(manifest.runtimeFingerprint)
    || !Array.isArray(manifest.files) || manifest.files.length !== ARTIFACT_NAMES.length
    || new Set(manifest.files.map(file => file.name)).size !== ARTIFACT_NAMES.length
    || manifest.files.some(file => !ARTIFACT_NAMES.includes(file.name) || !HASH.test(file.sha256)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > caps[file.name])
    || hash(canonical({ runtimeFingerprint: manifest.runtimeFingerprint, files: manifest.files })) !== snapshotId) {
    fail('graph_integrity', 'The active snapshot manifest does not match its identifier.');
  }
  let graphHandle = null, index, production, report;
  try {
    for (const metadata of manifest.files) {
      const keep = retainGraph && metadata.name === 'graph.json';
      const file = await regularFile(join(directory, metadata.name), caps[metadata.name], keep);
      if (keep) graphHandle = file.handle;
      if (file.data.length !== metadata.bytes || hash(file.data) !== metadata.sha256) fail('graph_integrity', 'A shared graph artifact failed its checksum.');
      if (metadata.name === 'project-brain.json') index = JSON.parse(file.data.toString('utf8'));
      if (metadata.name === 'production.json') production = validateProduction(JSON.parse(file.data.toString('utf8')));
      if (metadata.name === 'PROJECT_BRAIN.md') report = file.data.toString('utf8');
    }
    if (production.runtimeFingerprint !== manifest.runtimeFingerprint || index?.schemaVersion !== 1 || !Array.isArray(index.records)) {
      fail('graph_integrity', 'The shared graph artifacts have inconsistent provenance.');
    }
    return { directory, snapshotId, manifest, production, index, report, graphHandle,
      provenance: provenanceOf(snapshotId, production), close: async () => { await graphHandle?.close(); graphHandle = null; } };
  } catch (error) { await graphHandle?.close(); if (error instanceof SyntaxError) fail('graph_integrity', 'A shared graph artifact contains invalid JSON.'); throw error; }
}

async function readState(root, retainGraph = false) {
  try { root = await checkedDirectory(root); }
  catch (error) { if (error.code === 'ENOENT') return { state: 'missing', current: null, previous: null, target: null, snapshot: null }; throw error; }
  const pointer = await readJson(join(root, 'active.json'), 8192, true);
  const { desired, target } = await desiredTarget(root);
  if (!pointer) return { state: desired ? (target?.runtimeFingerprint === desired.runtimeFingerprint && target.state === 'failed' ? 'failed' : 'pending') : 'missing',
    current: null, previous: null, target: desired, snapshot: null };
  if (pointer.schemaVersion !== 1 || !HASH.test(pointer.current) || (pointer.previous !== null && !HASH.test(pointer.previous))) {
    fail('graph_integrity', 'The active graph pointer is invalid.');
  }
  const snapshot = await loadSnapshot(root, pointer.current, retainGraph);
  const mismatch = desired && desired.runtimeFingerprint !== snapshot.production.runtimeFingerprint;
  const failed = target?.runtimeFingerprint === (desired?.runtimeFingerprint ?? snapshot.production.runtimeFingerprint) && target.state === 'failed';
  const state = failed ? 'failed' : mismatch ? 'pending' : 'ready';
  return { state, current: pointer.current, previous: pointer.previous, target: desired, snapshot, provenance: snapshot.provenance };
}

export async function readStatus(root) {
  const state = await readState(root);
  try { const { snapshot, ...visible } = state; return visible; } finally { await state.snapshot?.close(); }
}

export async function loadActiveSnapshot(root) {
  const state = await readState(root, true);
  if (state.state !== 'ready') {
    await state.snapshot?.close();
    fail(state.state === 'missing' ? 'graph_unavailable' : 'graph_' + state.state,
      'The production graph is not ready for the current deployed version.');
  }
  return state.snapshot;
}

export async function recordTarget(root, target) {
  if (!target || !HASH.test(target.runtimeFingerprint) || !RELEASE.test(target.releaseId)
    || !['pending', 'failed'].includes(target.state)
    || (target.errorCode !== undefined && !/^[a-z][a-z0-9_]{0,79}$/.test(target.errorCode))) fail('invalid_target', 'Invalid production graph indexing target.');
  return locked(root, async () => {
    const { receipt } = await desiredTarget(root);
    if (receipt && receipt.runtimeFingerprint !== target.runtimeFingerprint) fail('stale_target', 'The indexing target is no longer the latest production receipt.');
    const value = { schemaVersion: 1, runtimeFingerprint: target.runtimeFingerprint, releaseId: target.releaseId,
      state: target.state, updatedAt: new Date().toISOString(), ...(target.errorCode ? { errorCode: target.errorCode } : {}) };
    await atomicJson(join(root, 'target.json'), value); return value;
  });
}

export async function publishSnapshot(root, { artifacts, production, verifyRuntime }) {
  validateProduction(production);
  if (!artifacts || typeof artifacts !== 'object' || Object.keys(artifacts).sort().join('|') !== ARTIFACT_NAMES.filter(name => name !== 'production.json').sort().join('|')
    || typeof verifyRuntime !== 'function') fail('invalid_snapshot', 'Supply the three fixed graph artifacts and a trusted runtime verifier.');
  const bodies = {};
  for (const name of ARTIFACT_NAMES) {
    const value = name === 'production.json' ? canonical(production) + '\n' : artifacts[name];
    if (!(typeof value === 'string' || Buffer.isBuffer(value))) fail('invalid_snapshot', 'Graph artifacts must be bytes, not source paths.');
    bodies[name] = Buffer.from(value);
    if (!bodies[name].length || bodies[name].length > caps[name]) fail('invalid_snapshot', 'A graph artifact has an invalid size.');
  }
  try {
    const graph = JSON.parse(bodies['graph.json'].toString('utf8')), index = JSON.parse(bodies['project-brain.json'].toString('utf8'));
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links ?? graph.edges) || index.schemaVersion !== 1 || !Array.isArray(index.records)) throw Error();
  } catch { fail('invalid_snapshot', 'The graph and project index must be valid structural JSON artifacts.'); }
  const files = ARTIFACT_NAMES.map(name => ({ name, sha256: hash(bodies[name]), bytes: bodies[name].length }));
  const snapshotId = hash(canonical({ runtimeFingerprint: production.runtimeFingerprint, files }));
  return locked(root, async () => {
    const verify = async () => {
      const actual = await verifyRuntime();
      if ((typeof actual === 'string' ? actual : actual?.runtimeFingerprint) !== production.runtimeFingerprint) fail('runtime_changed', 'The deployed runtime changed before graph publication.');
      const { receipt } = await desiredTarget(root);
      if (receipt && receipt.runtimeFingerprint !== production.runtimeFingerprint) fail('runtime_changed', 'A newer production receipt superseded this graph.');
    };
    await verify();
    await checkedDirectory(join(root, 'snapshots'), true);
    const directory = join(root, 'snapshots', snapshotId), temporary = join(root, 'snapshots', '.pending-' + randomUUID());
    const manifest = { schemaVersion: 1, snapshotId, runtimeFingerprint: production.runtimeFingerprint, files };
    let createdSnapshot = false, promoted = false;
    try {
      let existing = false;
      try { await lstat(directory); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing) { const snapshot = await loadSnapshot(root, snapshotId, false); await snapshot.close(); }
      else {
        await mkdir(temporary, { mode: 0o700 });
        for (const name of ARTIFACT_NAMES) await writeFile(join(temporary, name), bodies[name]);
        await writeFile(join(temporary, 'manifest.json'), canonical(manifest) + '\n');
        await rename(temporary, directory);
        createdSnapshot = true;
      }
      await verify();
      const old = await readJson(join(root, 'active.json'), 8192, true);
      if (old && (old.schemaVersion !== 1 || !HASH.test(old.current) || (old.previous !== null && !HASH.test(old.previous)))) fail('graph_integrity', 'The previous active pointer is invalid.');
      const previous = old?.current === snapshotId ? old.previous : old?.current ?? null;
      await atomicJson(join(root, 'active.json'), { schemaVersion: 1, current: snapshotId, previous });
      promoted = true;
      await atomicJson(join(root, 'target.json'), { schemaVersion: 1, runtimeFingerprint: production.runtimeFingerprint,
        releaseId: production.releaseId, state: 'ready', updatedAt: new Date().toISOString() });
      const removedSnapshots = [], warnings = [];
      for (const name of await readdir(join(root, 'snapshots'))) {
        if (!HASH.test(name) || [snapshotId, previous].includes(name)) continue;
        try {
          const retired = await loadSnapshot(root, name, false); await retired.close();
          const entries = await readdir(join(root, 'snapshots', name));
          if (entries.some(entry => ![...ARTIFACT_NAMES, 'manifest.json'].includes(entry))) throw Error();
          await rm(join(root, 'snapshots', name), { recursive: true }); removedSnapshots.push(name);
        } catch { warnings.push({ code: 'retired_snapshot_requires_review', snapshotId: name }); }
      }
      return { snapshotId, previousSnapshotId: previous, provenance: provenanceOf(snapshotId, production), removedSnapshots, warnings };
    } finally {
      await rm(temporary, { recursive: true, force: true });
      if (createdSnapshot && !promoted) await rm(directory, { recursive: true, force: true });
    }
  });
}
