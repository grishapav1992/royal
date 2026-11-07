import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  initializeAuditExportDirectory, inspectAuditExportFiles, registerAuditExportFile, removeAuditExportFiles, revalidateAuditExportFiles,
} from '../server/audit/cleanup-files';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'royal-cleanup-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const datasetId = randomUUID();
  const files = await initializeAuditExportDirectory(root, datasetId);
  const directory = dirname(files), trash = join(directory, 'trash'), receipts = join(directory, 'receipts');
  const add = async (name: string, content: string) => {
    await writeFile(join(files, name), content, { mode: 0o600 });
    return registerAuditExportFile(root, datasetId, name);
  };
  return { root, datasetId, directory, files, trash, receipts, add };
}

test('explicit registration binds exact bytes and metadata, leaving external exports out of scope', async t => {
  const f = await fixture(t);
  assert.equal(await initializeAuditExportDirectory(f.root, f.datasetId), f.files);
  const external = join(f.root, 'existing-report.csv');
  await writeFile(external, 'external', { mode: 0o600 });
  const json = await f.add('replay.json', '{}\n'), csv = await f.add('player.csv', 'column\nvalue\n');
  assert.deepEqual(await registerAuditExportFile(f.root, f.datasetId, 'player.csv'), csv);
  const receiptNames = await readdir(f.receipts);
  const manifest = await inspectAuditExportFiles(f.root, f.datasetId);
  assert.deepEqual(await readdir(f.receipts), receiptNames);
  assert.equal(manifest.datasetId, f.datasetId);
  assert.deepEqual(manifest.files.map(({ modifiedNs, changedNs, ...file }) => file), [csv, json]);
  const saved = await lstat(join(f.files, 'player.csv'), { bigint: true });
  assert.equal(manifest.files[0].modifiedNs, saved.mtimeNs.toString());
  assert.equal(manifest.files[0].changedNs, saved.ctimeNs.toString());
  await revalidateAuditExportFiles(f.root, manifest);
  assert.equal(manifest.totalBytes, 16);
  assert.equal(csv.sha256, createHash('sha256').update('column\nvalue\n').digest('hex'));
  assert.equal(csv.inode, (await lstat(join(f.files, 'player.csv'), { bigint: true })).ino.toString());
  assert(!JSON.stringify(manifest).includes(f.root));

  const result = await removeAuditExportFiles(f.root, JSON.parse(JSON.stringify(manifest)));
  assert.deepEqual(result, { removed: 2, removedBytes: 16, alreadyAbsent: 0 });
  assert.equal(await readFile(external, 'utf8'), 'external');
  assert.deepEqual(await readdir(f.files), []);
  assert.deepEqual(await readdir(f.receipts), receiptNames);
  assert.deepEqual(await removeAuditExportFiles(f.root, manifest), { removed: 0, removedBytes: 0, alreadyAbsent: 2 });
});

test('a committed deletion resumes staged or absent members of the same journal manifest', async t => {
  const f = await fixture(t);
  await f.add('absent.csv', 'one');
  await f.add('staged.csv', 'two');
  await f.add('untouched.json', 'three');
  const manifest = await inspectAuditExportFiles(f.root, f.datasetId);
  await unlink(join(f.files, 'absent.csv'));
  const stage = join(f.trash, 'staged.csv.' + randomUUID() + '.stage');
  await mkdir(stage, { mode: 0o700 });
  await rename(join(f.files, 'staged.csv'), join(stage, 'payload'));
  await assert.rejects(inspectAuditExportFiles(f.root, f.datasetId), { code: 'unexpected-object' });
  assert.deepEqual(await removeAuditExportFiles(f.root, manifest), { removed: 2, removedBytes: 8, alreadyAbsent: 1 });
  assert.deepEqual(await readdir(f.trash), []);
  assert.deepEqual(await removeAuditExportFiles(f.root, manifest), { removed: 0, removedBytes: 0, alreadyAbsent: 3 });
});

test('replacement and digest changes refuse the entire remaining deletion', async t => {
  const f = await fixture(t);
  await f.add('a.csv', 'first');
  await f.add('b.csv', 'second');
  const manifest = await inspectAuditExportFiles(f.root, f.datasetId);
  const a = join(f.files, 'a.csv'), b = join(f.files, 'b.csv');
  await writeFile(b, 'SECOND');
  await assert.rejects(removeAuditExportFiles(f.root, manifest), { code: 'file-changed' });
  assert.equal(await readFile(a, 'utf8'), 'first');
  assert.equal(await readFile(b, 'utf8'), 'SECOND');
  const old = join(f.root, 'old.csv');
  await rename(b, old);
  await writeFile(b, 'second', { mode: 0o600 });
  await assert.rejects(removeAuditExportFiles(f.root, manifest), { code: 'file-changed' });
  assert.equal(await readFile(b, 'utf8'), 'second');
  assert.equal(await readFile(old, 'utf8'), 'SECOND');
  assert.deepEqual(await readdir(f.trash), []);
});

test('symlinks, hardlinks, unregistered objects, and path escapes fail closed', async t => {
  const f = await fixture(t);
  const file = await f.add('a.csv', 'canonical');
  const manifest = await inspectAuditExportFiles(f.root, f.datasetId);
  const external = join(f.root, 'external.csv');
  await writeFile(external, 'external', { mode: 0o600 });
  const soft = join(f.files, 'soft.csv');
  await symlink(external, soft);
  await assert.rejects(registerAuditExportFile(f.root, f.datasetId, 'soft.csv'), { code: 'unexpected-object' });
  await assert.rejects(removeAuditExportFiles(f.root, manifest), { code: 'unexpected-object' });
  await unlink(soft);

  const hard = join(f.root, 'hard.csv');
  await link(join(f.files, file.name), hard);
  await assert.rejects(inspectAuditExportFiles(f.root, f.datasetId), { code: 'unexpected-object' });
  await assert.rejects(removeAuditExportFiles(f.root, manifest), { code: 'unexpected-object' });
  await unlink(hard);

  const unregistered = join(f.files, 'unexpected.csv');
  await writeFile(unregistered, 'unmanaged', { mode: 0o600 });
  await assert.rejects(inspectAuditExportFiles(f.root, f.datasetId), { code: 'unexpected-object' });
  await assert.rejects(removeAuditExportFiles(f.root, manifest), { code: 'unexpected-object' });
  await assert.rejects(registerAuditExportFile(f.root, f.datasetId, '../external.csv'), { code: 'unexpected-object' });
  assert.equal(await readFile(unregistered, 'utf8'), 'unmanaged');
  assert.equal(await readFile(external, 'utf8'), 'external');
  assert.equal(await readFile(join(f.files, file.name), 'utf8'), 'canonical');
});

test('root and dataset identity, strict metadata, privacy and size are checked', async t => {
  const f = await fixture(t);
  await f.add('report.csv', 'report');
  const manifest = await inspectAuditExportFiles(f.root, f.datasetId);
  const clone = join(f.root, 'clone');
  await mkdir(clone, { mode: 0o700 });
  await initializeAuditExportDirectory(clone, f.datasetId);
  await assert.rejects(removeAuditExportFiles(clone, manifest), { code: 'manifest-mismatch' });
  const alias = join(f.root, 'alias');
  await symlink(clone, alias);
  await assert.rejects(inspectAuditExportFiles(alias, f.datasetId), { code: 'managed-directory-invalid' });
  await assert.rejects(initializeAuditExportDirectory(f.root, '../anything'), { code: 'managed-directory-invalid' });
  await assert.rejects(removeAuditExportFiles(f.root, { ...manifest, totalBytes: manifest.totalBytes + 1 }),
    { code: 'manifest-mismatch' });
  const report = join(f.files, 'report.csv');
  await chmod(report, 0o644);
  await assert.rejects(inspectAuditExportFiles(f.root, f.datasetId), { code: 'unexpected-object' });
  await chmod(report, 0o600);
  const large = join(f.files, 'large.csv');
  await writeFile(large, '', { mode: 0o600 });
  await truncate(large, 64 * 1024 * 1024 + 1);
  await assert.rejects(registerAuditExportFile(f.root, f.datasetId, 'large.csv'), { code: 'limit-exceeded' });
  await unlink(large);
  const receipt = join(f.receipts, 'report.csv.receipt.json');
  const { modifiedNs, changedNs, ...registered } = manifest.files[0];
  await writeFile(receipt, JSON.stringify({ schemaVersion: 1, datasetId: randomUUID(), file: registered }));
  await assert.rejects(removeAuditExportFiles(f.root, manifest), { code: 'manifest-mismatch' });
  assert.equal(await readFile(report, 'utf8'), 'report');
});

test('a changed staged payload is preserved, even when its original name is absent', async t => {
  const f = await fixture(t);
  await f.add('staged.csv', 'canonical');
  const manifest = await inspectAuditExportFiles(f.root, f.datasetId);
  const stage = join(f.trash, 'staged.csv.' + randomUUID() + '.stage');
  await mkdir(stage, { mode: 0o700 });
  await rename(join(f.files, 'staged.csv'), join(stage, 'payload'));
  await writeFile(join(stage, 'payload'), 'replacement');
  await assert.rejects(removeAuditExportFiles(f.root, manifest), { code: 'file-changed' });
  assert.equal(await readFile(join(stage, 'payload'), 'utf8'), 'replacement');
});

test('fast revalidation rejects changes after SHA preflight even on the same inode and byte count', async t => {
  const f = await fixture(t);
  await f.add('report.csv', 'first');
  const target = join(f.files, 'report.csv');
  const manifest = await inspectAuditExportFiles(f.root, f.datasetId);
  const before = await lstat(target, { bigint: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  await writeFile(target, 'other');
  const after = await lstat(target, { bigint: true });
  assert.equal(after.ino, before.ino);
  assert.equal(after.size, before.size);
  await assert.rejects(revalidateAuditExportFiles(f.root, manifest), { code: 'file-changed' });
  assert.equal(await readFile(target, 'utf8'), 'other');
  assert.deepEqual(await readdir(f.trash), []);
});
