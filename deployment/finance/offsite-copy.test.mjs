import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureOffsiteCopy } from './offsite-copy.mjs';
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
