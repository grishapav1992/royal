import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decryptBackup, encryptBackup } from './offsite-crypto.mjs';

test('encrypted backups restore exactly and reject corruption, wrong keys and wrong checksums', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'royal-backup-test-'));
  try {
    const source = path.join(directory, 'source');
    const encrypted = path.join(directory, 'encrypted');
    const decrypted = path.join(directory, 'decrypted');
    const data = randomBytes(256 * 1024 + 17);
    const digest = createHash('sha256').update(data).digest('hex');
    const key = randomBytes(32);
    await writeFile(source, data);
    await encryptBackup(source, encrypted, key, digest);
    await decryptBackup(encrypted, decrypted, key, digest);
    assert.deepEqual(await readFile(decrypted), data);
    await assert.rejects(decryptBackup(encrypted, path.join(directory, 'wrong-key'), randomBytes(32), digest));
    await assert.rejects(readFile(path.join(directory, 'wrong-key')), { code: 'ENOENT' });
    const corrupt = await readFile(encrypted);
    corrupt[Math.floor(corrupt.length / 2)] ^= 1;
    await writeFile(path.join(directory, 'corrupt'), corrupt);
    await assert.rejects(decryptBackup(path.join(directory, 'corrupt'), path.join(directory, 'bad-output'), key, digest));
    await assert.rejects(readFile(path.join(directory, 'bad-output')), { code: 'ENOENT' });
    await assert.rejects(encryptBackup(source, path.join(directory, 'bad-checksum'), key, '0'.repeat(64)), /checksum/);
    await assert.rejects(readFile(path.join(directory, 'bad-checksum')), { code: 'ENOENT' });
    await assert.rejects(decryptBackup(encrypted, decrypted, key, digest), { code: 'EEXIST' });
    assert.deepEqual(await readFile(decrypted), data);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
