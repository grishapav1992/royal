import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, opendir, rename, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { isReplayId } from './replay-package';
import { writeAuditOutput } from './export-file';

const maximumFiles = 128;
const maximumFileBytes = 64 * 1024 * 1024;
const maximumTotalBytes = 256 * 1024 * 1024;
const maximumMetadataBytes = 4096;
const markerName = '.audit-dataset.json';
const receiptSuffix = '.receipt.json';
const stagePattern = /^(.+)\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.stage$/;
const topLevel = [markerName, 'files', 'receipts', 'trash'];

type Identity = { device: string; inode: string };
export type ManagedAuditExportFile = Identity & { name: string; bytes: number; sha256: string };
type InspectedFile = ManagedAuditExportFile & { modifiedNs: string; changedNs: string };
export type AuditExportFileManifest = {
  schemaVersion: 1;
  datasetId: string;
  root: Identity;
  directory: Identity;
  files: InspectedFile[];
  totalBytes: number;
};
type Layout = { root: string; directory: string; files: string; receipts: string; trash: string; identities: {
  root: Identity; directory: Identity; files: Identity; receipts: Identity; trash: Identity;
} };
type FileErrorCode = 'managed-directory-invalid' | 'unexpected-object' | 'file-changed' | 'limit-exceeded' | 'manifest-mismatch';
export class AuditCleanupFilesError extends Error {
  constructor(readonly code: FileErrorCode) {
    super('Managed audit exports: ' + code);
  }
}

const fail = (code: FileErrorCode): never => { throw new AuditCleanupFilesError(code); };
const errno = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
const owner = () => {
  const uid = process.getuid?.();
  if (uid === undefined) return fail('managed-directory-invalid');
  return BigInt(uid);
};
const fileName = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,118}\.(csv|json)$/.test(value);
const identity = (stat: BigIntStats): Identity => ({ device: stat.dev.toString(), inode: stat.ino.toString() });
const sameIdentity = (a: Identity, b: Identity) => a.device === b.device && a.inode === b.inode;
const unchanged = (before: BigIntStats, after: BigIntStats) => before.dev === after.dev && before.ino === after.ino
  && before.size === after.size && before.mode === after.mode && before.uid === after.uid && before.nlink === after.nlink
  && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
const sameFile = (a: ManagedAuditExportFile, b: ManagedAuditExportFile) =>
  a.name === b.name && a.bytes === b.bytes && a.sha256 === b.sha256 && sameIdentity(a, b);
const sameFiles = (a: ManagedAuditExportFile[], b: ManagedAuditExportFile[]) =>
  a.length === b.length && a.every((file, index) => sameFile(file, b[index]));

async function maybeStat(path: string) {
  return lstat(path, { bigint: true }).catch(error => {
    if (errno(error) === 'ENOENT') return null;
    throw error;
  });
}

async function privateDirectory(path: string): Promise<Identity> {
  const stat = await maybeStat(path);
  if (!stat?.isDirectory() || stat.uid !== owner() || (stat.mode & 0o777n) !== 0o700n) return fail('managed-directory-invalid');
  return identity(stat);
}

async function rootIdentity(root: string): Promise<Identity> {
  if (!isAbsolute(root) || resolve(root) !== root || root.includes('\0') || root === parse(root).root) {
    return fail('managed-directory-invalid');
  }
  const base = parse(root).root, uid = owner();
  let current = base;
  const parts = root.slice(base.length).split(sep);
  for (const component of parts.slice(0, -1)) {
    current = join(current, component);
    const stat = await maybeStat(current);
    // A writable non-sticky ancestor could let another account replace the selected root.
    if (!stat?.isDirectory() || stat.uid !== uid && stat.uid !== 0n
      || (stat.mode & 0o022n) !== 0n && (stat.mode & 0o1000n) === 0n) {
      return fail('managed-directory-invalid');
    }
  }
  return privateDirectory(root);
}

async function entries(path: string, maximum: number) {
  const directory = await opendir(path);
  const names: string[] = [];
  for await (const item of directory) {
    if (names.length === maximum) return fail('limit-exceeded');
    names.push(item.name);
  }
  return names.sort();
}

function checkFile(stat: BigIntStats, cap: number) {
  if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== owner() || (stat.mode & 0o077n) !== 0n) {
    return fail('unexpected-object');
  }
  if (stat.size > BigInt(cap)) return fail('limit-exceeded');
}

async function readExact(path: string, cap: number, consume: (chunk: Buffer) => void) {
  const before = await maybeStat(path);
  if (!before) return fail('file-changed');
  checkFile(before, cap);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!unchanged(before, opened)) return fail('file-changed');
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, cap));
    let count = 0;
    while (count < Number(before.size)) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - count), count);
      if (!bytesRead) return fail('file-changed');
      consume(buffer.subarray(0, bytesRead));
      count += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await maybeStat(path);
    if (!named || !unchanged(before, after) || !unchanged(after, named)) return fail('file-changed');
    return { ...identity(after), bytes: count, modifiedNs: after.mtimeNs.toString(), changedNs: after.ctimeNs.toString() };
  } finally {
    await handle.close();
  }
}

async function readMetadata(path: string): Promise<unknown> {
  const chunks: Buffer[] = [];
  await readExact(path, maximumMetadataBytes, chunk => chunks.push(Buffer.from(chunk)));
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail('manifest-mismatch'); }
}

function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validIdentity(value: unknown): value is Identity {
  return fields(value, ['device', 'inode']) && typeof value.device === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value.device)
    && typeof value.inode === 'string' && /^[1-9][0-9]{0,19}$/.test(value.inode);
}

function validFile(value: unknown): value is ManagedAuditExportFile {
  return fields(value, ['name', 'bytes', 'sha256', 'device', 'inode']) && fileName(value.name)
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= maximumFileBytes
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && validIdentity({ device: value.device, inode: value.inode });
}

const nanoseconds = (value: unknown) => typeof value === 'string' && /^(0|-?[1-9][0-9]{0,21})$/.test(value);

function validInspectedFile(value: unknown): value is InspectedFile {
  if (!fields(value, ['name', 'bytes', 'sha256', 'device', 'inode', 'modifiedNs', 'changedNs'])) return false;
  const { modifiedNs, changedNs, ...file } = value;
  return nanoseconds(modifiedNs) && nanoseconds(changedNs) && validFile(file);
}

function total(files: ManagedAuditExportFile[]) {
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (bytes > maximumTotalBytes) return fail('limit-exceeded');
  return bytes;
}

function validManifest(value: unknown): value is AuditExportFileManifest {
  if (!fields(value, ['schemaVersion', 'datasetId', 'root', 'directory', 'files', 'totalBytes'])
    || value.schemaVersion !== 1 || !isReplayId(value.datasetId) || !validIdentity(value.root) || !validIdentity(value.directory)
    || !Array.isArray(value.files) || value.files.length > maximumFiles || !value.files.every(validInspectedFile)) return false;
  const files = value.files;
  return files.every((file, index) => !index || files[index - 1].name < file.name) && value.totalBytes === total(files);
}

async function digest(path: string, name: string): Promise<InspectedFile> {
  const hash = createHash('sha256');
  const metadata = await readExact(path, maximumFileBytes, chunk => hash.update(chunk));
  return { name, ...metadata, sha256: hash.digest('hex') };
}

async function syncDirectory(path: string) {
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); }
  finally { await directory.close(); }
}

async function layout(root: string, datasetId: string): Promise<Layout> {
  if (!isReplayId(datasetId)) return fail('managed-directory-invalid');
  const rootId = await rootIdentity(root), directory = join(root, datasetId);
  const directoryId = await privateDirectory(directory);
  const names = await entries(directory, topLevel.length);
  if (names.length !== topLevel.length || names.some((name, index) => name !== topLevel[index])) return fail('unexpected-object');
  const files = join(directory, 'files'), receipts = join(directory, 'receipts'), trash = join(directory, 'trash');
  const [filesId, receiptsId, trashId] = await Promise.all([privateDirectory(files), privateDirectory(receipts), privateDirectory(trash)]);
  if ([directoryId, filesId, receiptsId, trashId].some(id => id.device !== rootId.device)) return fail('managed-directory-invalid');
  const marker = await readMetadata(join(directory, markerName));
  if (!fields(marker, ['schemaVersion', 'datasetId']) || marker.schemaVersion !== 1 || marker.datasetId !== datasetId) {
    return fail('manifest-mismatch');
  }
  return { root, directory, files, receipts, trash,
    identities: { root: rootId, directory: directoryId, files: filesId, receipts: receiptsId, trash: trashId } };
}

async function checkLayout(value: Layout) {
  if (!sameIdentity(value.identities.root, await rootIdentity(value.root))) return fail('manifest-mismatch');
  for (const name of ['directory', 'files', 'receipts', 'trash'] as const) {
    if (!sameIdentity(value.identities[name], await privateDirectory(value[name]))) return fail('manifest-mismatch');
  }
}

async function receiptAt(path: string, datasetId: string, name: string) {
  const receipt = await readMetadata(path);
  if (!fields(receipt, ['schemaVersion', 'datasetId', 'file']) || receipt.schemaVersion !== 1 || receipt.datasetId !== datasetId
    || !validFile(receipt.file) || receipt.file.name !== name) return fail('manifest-mismatch');
  return receipt.file;
}

async function registered(value: Layout, datasetId: string) {
  const receipts = await entries(value.receipts, maximumFiles);
  const files: ManagedAuditExportFile[] = [];
  for (const receipt of receipts) {
    const name = receipt.endsWith(receiptSuffix) ? receipt.slice(0, -receiptSuffix.length) : null;
    if (!fileName(name)) return fail('unexpected-object');
    files.push(await receiptAt(join(value.receipts, receipt), datasetId, name));
  }
  files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  total(files);
  return files;
}

async function writeMetadata(path: string, value: unknown) {
  const result = await writeAuditOutput(path, () => {}, async file => {
    await file.writeFile(JSON.stringify(value) + '\n', 'utf8');
    return {};
  });
  if (result.cleanupPending) return fail('unexpected-object');
}

/** Initializes only the named dataset below an existing private, normalized root. */
export async function initializeAuditExportDirectory(root: string, datasetId: string): Promise<string> {
  if (!isReplayId(datasetId)) return fail('managed-directory-invalid');
  await rootIdentity(root);
  const directory = join(root, datasetId);
  if (await maybeStat(directory)) return (await layout(root, datasetId)).files;
  await mkdir(directory, { mode: 0o700 });
  for (const name of ['files', 'receipts', 'trash']) await mkdir(join(directory, name), { mode: 0o700 });
  await writeMetadata(join(directory, markerName), { schemaVersion: 1, datasetId });
  await syncDirectory(directory);
  await syncDirectory(root);
  return (await layout(root, datasetId)).files;
}

/** Marks one existing file in the managed directory. A registered name is immutable. */
export async function registerAuditExportFile(root: string, datasetId: string, name: string): Promise<ManagedAuditExportFile> {
  if (!fileName(name)) return fail('unexpected-object');
  const value = await layout(root, datasetId);
  if ((await entries(value.trash, maximumFiles)).length) return fail('unexpected-object');
  const files = await registered(value, datasetId);
  const { modifiedNs: _modified, changedNs: _changed, ...file } = await digest(join(value.files, name), name);
  const path = join(value.receipts, name + receiptSuffix);
  const previous = files.find(entry => entry.name === name);
  if (previous) return sameFile(previous, file) ? previous : fail('file-changed');
  if (files.length === maximumFiles) return fail('limit-exceeded');
  total([...files, file]);
  await checkLayout(value);
  try { await writeMetadata(path, { schemaVersion: 1, datasetId, file }); }
  catch (error) {
    if (errno(error) !== 'EEXIST') throw error;
    if (!sameFile(await receiptAt(path, datasetId, name), file)) return fail('file-changed');
  }
  await syncDirectory(value.receipts);
  return file;
}

async function expectCompleteLayout(value: Layout, files: ManagedAuditExportFile[]) {
  const names = await entries(value.files, maximumFiles);
  if ((await entries(value.trash, maximumFiles)).length || names.some(name => !files.some(file => file.name === name))) {
    return fail('unexpected-object');
  }
  if (names.length !== files.length) return fail('file-changed');
}

async function matchManifest(root: string, manifest: AuditExportFileManifest) {
  if (!validManifest(manifest)) return fail('manifest-mismatch');
  const value = await layout(root, manifest.datasetId);
  if (!sameIdentity(value.identities.root, manifest.root) || !sameIdentity(value.identities.directory, manifest.directory)) {
    return fail('manifest-mismatch');
  }
  const files = await registered(value, manifest.datasetId);
  if (!sameFiles(files, manifest.files)) return fail('manifest-mismatch');
  return { value, files };
}

/** Dry run. Requires a complete, unchanged set and opens files only for reading. */
export async function inspectAuditExportFiles(root: string, datasetId: string): Promise<AuditExportFileManifest> {
  const value = await layout(root, datasetId);
  const receipts = await registered(value, datasetId);
  await expectCompleteLayout(value, receipts);
  const files: InspectedFile[] = [];
  for (const receipt of receipts) {
    const file = await digest(join(value.files, receipt.name), receipt.name);
    if (!sameFile(receipt, file)) return fail('file-changed');
    files.push(file);
  }
  await checkLayout(value);
  return { schemaVersion: 1, datasetId, root: value.identities.root, directory: value.identities.directory, files, totalBytes: total(files) };
}

/** Fast apply-side check after preflight, before the database commits any deletion. */
export async function revalidateAuditExportFiles(root: string, manifest: AuditExportFileManifest): Promise<void> {
  const { value, files } = await matchManifest(root, manifest);
  await expectCompleteLayout(value, files);
  for (const file of manifest.files) {
    const stat = await maybeStat(join(value.files, file.name));
    if (!stat) return fail('file-changed');
    checkFile(stat, maximumFileBytes);
    if (!sameIdentity(file, identity(stat)) || BigInt(file.bytes) !== stat.size
      || file.modifiedNs !== stat.mtimeNs.toString() || file.changedNs !== stat.ctimeNs.toString()) return fail('file-changed');
  }
  await checkLayout(value);
}

type Stage = { directory: string; payload: string | null };
async function staged(value: Layout, files: ManagedAuditExportFile[]) {
  const byFile = new Map<string, Stage>();
  for (const name of await entries(value.trash, maximumFiles)) {
    const file = stagePattern.exec(name)?.[1];
    if (!file || !files.some(entry => entry.name === file) || byFile.has(file)) return fail('unexpected-object');
    const directory = join(value.trash, name);
    const stageId = await privateDirectory(directory);
    if (stageId.device !== value.identities.trash.device) return fail('unexpected-object');
    const children = await entries(directory, 1);
    if (children.length && children[0] !== 'payload') return fail('unexpected-object');
    byFile.set(file, { directory, payload: children.length ? join(directory, 'payload') : null });
  }
  return byFile;
}

/** Run only after database cleanup has committed. It is safe to resume a partly removed journal manifest. */
export async function removeAuditExportFiles(root: string, manifest: AuditExportFileManifest) {
  const { value, files } = await matchManifest(root, manifest);
  const names = new Set(await entries(value.files, maximumFiles));
  const stages = await staged(value, files);
  if ([...names].some(name => !files.some(file => file.name === name))) return fail('unexpected-object');

  // Verify every remaining object before moving or deleting any of them.
  for (const file of files) {
    const stage = stages.get(file.name)?.payload;
    const path = names.has(file.name) ? join(value.files, file.name) : stage;
    if (stage && path !== stage) return fail('file-changed');
    if (path && !sameFile(file, await digest(path, file.name))) return fail('file-changed');
  }
  let removed = 0, removedBytes = 0, alreadyAbsent = 0;
  for (const file of files) {
    await checkLayout(value);
    let stage = stages.get(file.name);
    if (names.has(file.name)) {
      if (stage) await rmdir(stage.directory);
      const directory = join(value.trash, file.name + '.' + randomUUID() + '.stage');
      await mkdir(directory, { mode: 0o700 });
      await syncDirectory(value.trash);
      const payload = join(directory, 'payload');
      try { await rename(join(value.files, file.name), payload); }
      catch (error) {
        await rmdir(directory).catch(() => {});
        if (errno(error) === 'ENOENT') return fail('file-changed');
        throw error;
      }
      await syncDirectory(value.files);
      await syncDirectory(directory);
      stage = { directory, payload };
    }
    if (stage?.payload) {
      // The isolated destination cannot overwrite another path. A raced replacement is preserved.
      if (!sameFile(file, await digest(stage.payload, file.name))) return fail('file-changed');
      await unlink(stage.payload);
      await syncDirectory(stage.directory);
      removed++;
      removedBytes += file.bytes;
    } else alreadyAbsent++;
    if (stage) await rmdir(stage.directory);
  }
  await syncDirectory(value.files);
  await syncDirectory(value.trash);
  await checkLayout(value);
  if (!sameFiles(await registered(value, manifest.datasetId), manifest.files)) return fail('manifest-mismatch');
  if ((await entries(value.files, maximumFiles)).length || (await entries(value.trash, maximumFiles)).length) {
    return fail('unexpected-object');
  }
  return { removed, removedBytes, alreadyAbsent };
}
