import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureOffsiteCopy, pruneOffsiteCopies } from './offsite-copy.mjs';
import { decryptBackup } from './offsite-crypto.mjs';

test('each existing external copy is authenticated and corruption requires a verified replacement', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'royal-offsite-copy-'));
  const content = randomBytes(4096), key = randomBytes(32);
  const name = 'finance-20261006T040000Z-aaaaaaaa.dump';
  const sha256 = createHash('sha256').update(content).digest('hex');
  const latest = { directory: '/opt/royal-finance-backups', metadata: {
    file: name, sha256, created_at: new Date().toISOString(), environment: 'simulation' } };
  let downloads = 0;
  const download = async target => { downloads++; await writeFile(target, content, { mode: 0o600 }); };
  const encrypted = path.join(directory, name + '.aes256gcm');
  try {
    await ensureOffsiteCopy(latest, directory, key, download);
    assert.equal(downloads, 1);
    const checked = await ensureOffsiteCopy(latest, directory, key, download);
    assert.ok(checked.verified_at);
    assert.equal(downloads, 1);
    const corrupted = await readFile(encrypted); corrupted[corrupted.length - 1] ^= 1;
    await writeFile(encrypted, corrupted);
    await assert.rejects(ensureOffsiteCopy(latest, directory, key, async () => { throw new Error('server_unreachable'); }), /server_unreachable/);
    assert.equal((await readdir(directory)).filter(name => name.includes('.partial')).length, 0);
    const repaired = await ensureOffsiteCopy(latest, directory, key, download);
    assert.ok(repaired.repaired_at);
    assert.equal(downloads, 2);
    const restored = path.join(directory, 'restored.dump');
    await decryptBackup(encrypted, restored, key, sha256);
    assert.deepEqual(await readFile(restored), content);
    await assert.rejects(ensureOffsiteCopy(latest, directory, randomBytes(32), async () => { throw new Error('server_unreachable'); }));
    assert.equal((await readdir(directory)).filter(name => name.includes('.partial')).length, 0);
    await assert.rejects(ensureOffsiteCopy({ ...latest, directory: '/untrusted' }, directory, key, download), /backup_metadata_invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function storedCopy(directory, name, meta) {
  await writeFile(path.join(directory, name + '.aes256gcm'), randomBytes(64), { mode: 0o600 });
  await writeFile(path.join(directory, name + '.json'), JSON.stringify(meta) + '\n', { mode: 0o600 });
}
const copies = async directory => (await readdir(directory)).filter(name => name.endsWith('.aes256gcm')).map(name => name.slice(0, -10)).sort();

test('a new copy keeps itself and the newest copy whose exact bytes passed a server restore', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'royal-offsite-retention-'));
  const key = randomBytes(32), content = randomBytes(2048);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const verified = sha => ({ sha256: sha, encrypted_verified: true, server_restore: { ok: true, sha256: sha } });
  const names = ['finance-20261018T100000Z-11111111.dump', 'finance-20261019T100000Z-22222222.dump',
    'finance-20261020T100000Z-33333333.dump', 'finance-20261021T100000Z-44444444.dump',
    'finance-20261022T100000Z-55555555.dump', 'finance-20261023T100000Z-66666666.dump'];
  try {
    await storedCopy(directory, names[0], verified('a'.repeat(64)));
    await storedCopy(directory, names[1], verified('b'.repeat(64)));
    // A restore result for other bytes does not prove this copy.
    await storedCopy(directory, names[2], { sha256: 'c'.repeat(64), encrypted_verified: true, server_restore: { ok: true, sha256: 'f'.repeat(64) } });
    await storedCopy(directory, names[3], { sha256: 'd'.repeat(64), encrypted_verified: true, server_restore: { ok: false } });
    // An incomplete or unreadable copy is left for inspection.
    await storedCopy(directory, names[4], { sha256: 'e'.repeat(64) });
    const newest = 'finance-20261110T200000Z-77777777.dump';
    await ensureOffsiteCopy({ directory: '/opt/royal-finance-backups', metadata: { file: newest, sha256, environment: 'simulation' } },
      directory, key, async target => writeFile(target, content, { mode: 0o600 }));
    assert.deepEqual(await copies(directory), [names[1], names[4], newest]);
    assert.ok((await readdir(directory)).includes(names[1] + '.json'));
    assert.ok(!(await readdir(directory)).includes(names[0] + '.json'));
    // Once the newest copy is restore-verified, the older verified copy is no longer needed.
    await storedCopy(directory, names[5], verified('9'.repeat(64)));
    assert.deepEqual(await pruneOffsiteCopies(directory, newest), [names[1]]);
    assert.deepEqual(await copies(directory), [names[4], names[5], newest]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('without any restore-verified copy only the newest authenticated copy remains', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'royal-offsite-retention-'));
  try {
    await storedCopy(directory, 'finance-20261020T100000Z-aaaaaaaa.dump', { sha256: 'a'.repeat(64), encrypted_verified: true });
    await storedCopy(directory, 'finance-20261021T100000Z-bbbbbbbb.dump', { sha256: 'b'.repeat(64), encrypted_verified: true });
    assert.deepEqual(await pruneOffsiteCopies(directory, 'finance-20261021T100000Z-bbbbbbbb.dump'), ['finance-20261020T100000Z-aaaaaaaa.dump']);
    assert.deepEqual(await copies(directory), ['finance-20261021T100000Z-bbbbbbbb.dump']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
