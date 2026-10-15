import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('ROYAL-FINANCE-BACKUP-v1\n');

function hashing(digest) {
  return new Transform({ transform(chunk, _encoding, done) { digest.update(chunk); done(null, chunk); } });
}

async function syncFile(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function encryptBackup(source, destination, key, expectedSha256) {
  if (key.length !== 32) throw new Error('invalid_backup_key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const digest = createHash('sha256');
  // Reserve the target before the error cleanup can run, preserving existing files.
  const handle = await open(destination, 'wx', 0o600);
  await handle.close();
  try {
    const output = createWriteStream(destination, { flags: 'a' });
    output.write(Buffer.concat([MAGIC, iv]));
    await pipeline(createReadStream(source), hashing(digest), cipher, output);
    if (digest.digest('hex') !== expectedSha256) throw new Error('download_checksum_mismatch');
    await appendFile(destination, cipher.getAuthTag());
    await syncFile(destination);
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
}

export async function decryptBackup(source, destination, key, expectedSha256) {
  if (key.length !== 32) throw new Error('invalid_backup_key');
  const size = (await stat(source)).size;
  if (size <= MAGIC.length + 12 + 16) throw new Error('invalid_encrypted_backup');
  const input = await open(source, 'r');
  const header = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  try {
    await input.read(header, 0, header.length, 0);
    await input.read(tag, 0, 16, size - 16);
  } finally { await input.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('invalid_encrypted_backup');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const digest = createHash('sha256');
  const handle = await open(destination, 'wx', 0o600);
  await handle.close();
  try {
    await pipeline(createReadStream(source, { start: header.length, end: size - 17 }),
      decipher, hashing(digest), createWriteStream(destination, { flags: 'a' }));
    if (digest.digest('hex') !== expectedSha256) throw new Error('decrypted_checksum_mismatch');
    await syncFile(destination);
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
}
