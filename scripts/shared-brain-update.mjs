import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishSnapshot, readStatus, recordTarget, SharedBrainError, validateProduction } from './shared-brain-store.mjs';

const HASH = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/, RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RECEIPT_CAP = 16 * 1024 * 1024;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw new SharedBrainError(code, message); };

export function receiptFingerprint(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('invalid_receipt', 'Invalid production graph receipt.');
  const identity = Object.fromEntries(Object.entries(receipt).filter(([key]) => !['collectedAt', 'runtimeFingerprint'].includes(key)));
  return digest(canonical(identity));
}

function validateReceipt(receipt) {
  if (receipt?.schemaVersion !== 1 || receipt.verified !== true || !HASH.test(receipt.runtimeFingerprint)
    || !RELEASE.test(receipt.release) || !COMMIT.test(receipt.sourceCommit)
    || !Array.isArray(receipt.components) || !receipt.components.length
    || receiptFingerprint(receipt) !== receipt.runtimeFingerprint) fail('invalid_receipt', 'The production graph receipt is not a verified immutable identity.');
  return receipt;
}

async function trustedDirectory(path, ownerUid, create = false) {
  const full = resolve(path), base = parse(full).root;
  let current = base;
  for (const part of full.slice(base.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await mkdir(current, { mode: 0o700 }); info = await lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022)
      || ![0, ownerUid].includes(info.uid)) fail('untrusted_update_input', 'Shared graph directories require trusted ownership and permissions.');
  }
  return full;
}

async function safeBytes(path, ownerUid, cap = RECEIPT_CAP) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== ownerUid || before.mode & 0o022
      || before.size < 1 || before.size > cap) fail('untrusted_update_input', 'A shared graph input has unsafe ownership, permissions or size.');
    const data = await file.readFile(), after = await file.stat();
    if (data.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail('untrusted_update_input', 'A shared graph input changed during reading.');
    return data;
  } finally { await file.close(); }
}

async function safeJson(path, ownerUid, cap) {
  try { return JSON.parse((await safeBytes(path, ownerUid, cap)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) fail('untrusted_update_input', 'A shared graph input is not valid JSON.'); throw error; }
}

function safeRelative(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 2048 && !/[\\\u0000-\u001f\u007f]/.test(path)
    && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..');
}

async function installedGeneration(programRoot, ownerUid) {
  const receipt = await safeJson(join(programRoot, 'install-receipt.json'), ownerUid, 2 * 1024 * 1024);
  if (receipt?.schemaVersion !== 1 || receipt.githubVerified !== true || !COMMIT.test(receipt.sourceCommit)
    || !Array.isArray(receipt.files) || !receipt.files.length || receipt.files.length > 4096
    || receipt.files.some(row => !safeRelative(row?.path) || !HASH.test(row?.sha256))
    || new Set(receipt.files.map(row => row.path)).size !== receipt.files.length) fail('invalid_tool_receipt', 'The graph service source must be bound to a verified GitHub installation.');
  const files = receipt.files.map(({ path, sha256 }) => ({ path, sha256 })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (const row of files) {
    await trustedDirectory(dirname(join(programRoot, row.path)), ownerUid);
    if (digest(await safeBytes(join(programRoot, row.path), ownerUid, 32 * 1024 * 1024)) !== row.sha256) fail('invalid_tool_receipt', 'Installed graph service bytes differ from their GitHub source receipt.');
  }
  return { toolSourceCommit: receipt.sourceCommit, toolGenerationHash: digest(canonical({ sourceCommit: receipt.sourceCommit, files })) };
}

async function updateLock(root, ownerUid, callback) {
  const path = join(root, '.update.lock');
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(path), previous = await safeJson(path, ownerUid, 512);
    if (!Number.isSafeInteger(previous?.pid) || previous.pid < 1) fail('update_locked', 'The graph updater lock requires review.');
    try { process.kill(previous.pid, 0); fail('update_locked', 'Another graph update is running.'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    const current = await lstat(path);
    if (current.ino !== info.ino || current.dev !== info.dev) fail('update_locked', 'The graph updater lock changed.');
    await rm(path); lock = await open(path, 'wx', 0o600);
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, owner: randomUUID() })); await lock.sync(); return await callback(); }
  finally { await lock.close(); await rm(path, { force: true }); }
}

export async function verifyReceiptRuntime(receiptPath) {
  return new Promise((accept, reject) => {
    const allowed = ['PATH', 'HOME', 'LANG', 'LC_ALL'];
    const env = Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.PATH = '/opt/royal-project-brain/runtime/bin:' + (env.PATH || '/usr/local/bin:/usr/bin:/bin');
    const child = spawn('python3', ['/opt/royal-maintenance/bin/production-graph-receipt.py', '--check', receiptPath],
      { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let body = '', overflow = false;
    child.stdout.on('data', chunk => { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 8192) { overflow = true; child.kill(); } });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000); timer.unref();
    const unavailable = () => new SharedBrainError('runtime_unverified', 'The deployed program no longer matches the verified graph receipt.', 4);
    child.once('error', () => { clearTimeout(timer); reject(unavailable()); });
    child.once('close', code => {
      clearTimeout(timer);
      if (overflow || code !== 0) return reject(unavailable());
      try { const result = JSON.parse(body); if (!HASH.test(result?.runtimeFingerprint)) throw Error(); accept(result); }
      catch { reject(unavailable()); }
    });
  });
}

async function pruneReceipts(root, ownerUid, latestFingerprint) {
  const keep = new Set([latestFingerprint]), warnings = [];
  const status = await readStatus(root);
  if (status.provenance?.runtimeFingerprint) keep.add(status.provenance.runtimeFingerprint);
  if (status.target?.runtimeFingerprint) keep.add(status.target.runtimeFingerprint);
  if (status.previous) {
    const previous = validateProduction(await safeJson(join(root, 'snapshots', status.previous, 'production.json'), ownerUid));
    keep.add(previous.runtimeFingerprint);
  }
  try {
    const target = await safeJson(join(root, 'target.json'), ownerUid, 8192);
    if (target.state === 'pending' && HASH.test(target.runtimeFingerprint)) keep.add(target.runtimeFingerprint);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const directory = await trustedDirectory(join(root, 'receipts'), ownerUid), removedReceipts = [];
  const earliestRemoval = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of await readdir(directory)) {
    const match = /^([a-f0-9]{64})\.json$/.exec(name);
    if (!match || keep.has(match[1])) continue;
    try {
      const info = await lstat(join(directory, name));
      if (info.mtimeMs > earliestRemoval) continue;
      const latest = validateReceipt(await safeJson(join(directory, 'latest.json'), ownerUid));
      if (latest.runtimeFingerprint === match[1]) continue;
      const candidate = validateReceipt(await safeJson(join(directory, name), ownerUid));
      if (candidate.runtimeFingerprint !== match[1]) throw Error();
      await rm(join(directory, name)); removedReceipts.push(match[1]);
    } catch { warnings.push({ code: 'retired_receipt_requires_review', runtimeFingerprint: match[1] }); }
  }
  return { removedReceipts, warnings };
}

export async function updateProductionGraph({ storeRoot = '/var/lib/royal-project-brain',
  programRoot = dirname(dirname(fileURLToPath(import.meta.url))), liveRoot = '/opt/royal', workRoot,
  builder, verifyRuntime = verifyReceiptRuntime, ownerUid = 0 } = {}) {
  if (!Number.isSafeInteger(ownerUid) || ownerUid < 0) fail('invalid_update_configuration', 'Invalid graph updater owner.');
  const root = await trustedDirectory(storeRoot, ownerUid, true);
  const program = await trustedDirectory(await realpath(programRoot), ownerUid);
  return updateLock(root, ownerUid, async () => {
    const receiptDirectory = await trustedDirectory(join(root, 'receipts'), ownerUid);
    const receipt = validateReceipt(await safeJson(join(receiptDirectory, 'latest.json'), ownerUid));
    const receiptPath = join(receiptDirectory, receipt.runtimeFingerprint + '.json');
    const immutable = validateReceipt(await safeJson(receiptPath, ownerUid));
    if (canonical(receipt) !== canonical(immutable)) fail('invalid_receipt', 'The latest production receipt differs from its immutable stored identity.');
    const generation = await installedGeneration(program, ownerUid);
    const verify = async () => {
      // Only the trusted fixed receipt path reaches the Python live verifier.
      let actual;
      try { actual = await verifyRuntime(receiptPath, receipt); }
      catch { throw new SharedBrainError('runtime_unverified', 'The deployed program no longer matches the verified graph receipt.', 4); }
      if ((typeof actual === 'string' ? actual : actual?.runtimeFingerprint) !== receipt.runtimeFingerprint) {
        throw new SharedBrainError('runtime_changed', 'The deployed runtime changed before graph publication.', 4);
      }
      return actual;
    };
    let scratch;
    try {
      const status = await readStatus(root);
      if (status.state === 'ready' && status.provenance.runtimeFingerprint === receipt.runtimeFingerprint) {
        const current = await safeJson(join(root, 'snapshots', status.current, 'production.json'), ownerUid);
        if (current.toolSourceCommit === generation.toolSourceCommit && current.toolGenerationHash === generation.toolGenerationHash) {
          await verify();
          const latestStatus = await readStatus(root);
          if (latestStatus.state !== 'ready' || latestStatus.current !== status.current
            || latestStatus.provenance.runtimeFingerprint !== receipt.runtimeFingerprint) {
            throw new SharedBrainError('runtime_changed', 'A newer production target superseded the unchanged graph check.', 4);
          }
          return { status: 'unchanged', snapshotId: status.current, runtimeFingerprint: receipt.runtimeFingerprint, ...generation };
        }
      }
      await recordTarget(root, { runtimeFingerprint: receipt.runtimeFingerprint, releaseId: receipt.release, state: 'pending' });
      await verify();
      const workspace = resolve(workRoot ?? join(root, 'work'));
      if (workspace !== join(root, 'work')) fail('invalid_update_configuration', 'Graph work files must stay in the store work directory.');
      await trustedDirectory(workspace, ownerUid, true);
      scratch = await mkdtemp(join(workspace, 'update-'));
      const build = builder ?? (await import('./production-brain-build.mjs')).buildProductionArtifacts;
      const result = await build(receipt, { programRoot: program, liveRoot: resolve(liveRoot), workRoot: scratch });
      if (!result || result.production?.runtimeFingerprint !== receipt.runtimeFingerprint
        || result.production?.releaseId !== receipt.release) fail('invalid_build_result', 'The graph builder returned an unrelated production identity.');
      const production = { ...result.production, ...generation };
      const published = await publishSnapshot(root, { artifacts: result.artifacts, production, verifyRuntime: verify });
      const retention = await pruneReceipts(root, ownerUid, receipt.runtimeFingerprint);
      return { status: 'published', ...published, runtimeFingerprint: receipt.runtimeFingerprint, ...generation,
        removedReceipts: retention.removedReceipts, warnings: [...published.warnings, ...retention.warnings] };
    } catch (error) {
      const safe = error instanceof SharedBrainError ? error : new SharedBrainError('index_failed', 'The production graph update failed; the previous snapshot has been preserved.');
      try { await recordTarget(root, { runtimeFingerprint: receipt.runtimeFingerprint, releaseId: receipt.release, state: 'failed', errorCode: safe.code }); }
      catch (recordError) { if (recordError.code !== 'stale_target') throw new SharedBrainError('target_record_failed', 'The graph update failed and its status could not be saved.'); }
      throw safe;
    } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  });
}

async function main() {
  if (process.getuid?.() !== 0 || process.argv.length !== 2) fail('invalid_update_configuration', 'The graph updater requires root and accepts no command arguments.');
  process.umask(0o077);
  const result = await updateProductionGraph({ storeRoot: process.env.ROYAL_BRAIN_STORE || '/var/lib/royal-project-brain',
    liveRoot: process.env.ROYAL_BRAIN_LIVE_ROOT || '/opt/royal' });
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, ...result }) + '\n');
}

const isMain = process.argv[1] && await realpath(resolve(process.argv[1])).then(path => pathToFileURL(path).href === import.meta.url).catch(() => false);
if (isMain) {
  main().catch(error => { const safe = error instanceof SharedBrainError ? error : new SharedBrainError('index_failed', 'The production graph updater could not complete.');
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: safe.code, message: safe.message } }) + '\n'); process.exitCode = safe.exitCode; });
}
