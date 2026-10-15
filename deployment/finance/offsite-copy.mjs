import { randomBytes } from 'node:crypto';
import { open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { decryptBackup, encryptBackup } from './offsite-crypto.mjs';

export const backupFilenamePattern = /^finance-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/;

async function metadataAt(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}
async function saveMetadata(file, value) {
  const temporary = file + '.' + randomBytes(6).toString('hex') + '.partial';
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

// download writes only to the supplied private staging path. Existing copies are authenticated on every pass.
export async function ensureOffsiteCopy(latest, backups, key, download) {
  const meta = latest.metadata;
  if (latest.directory !== '/opt/royal-finance-backups' || !meta || !backupFilenamePattern.test(meta.file)
    || !/^[a-f0-9]{64}$/.test(meta.sha256) || meta.environment !== 'simulation') throw new Error('backup_metadata_invalid');
  const encrypted = path.join(backups, meta.file + '.aes256gcm');
  const metadataFile = path.join(backups, meta.file + '.json');
  const existing = await metadataAt(metadataFile);
  const temporary = path.join(backups, meta.file + '.' + randomBytes(6).toString('hex') + '.partial');
  const temporaryEncrypted = temporary + '.aes256gcm', temporaryRestored = temporary + '.restore';
  let repair = false;
  try {
    if (existing.sha256 === meta.sha256 && existing.encrypted_verified === true) {
      try {
        await decryptBackup(encrypted, temporaryRestored, key, meta.sha256);
        existing.verified_at = new Date().toISOString();
        if (latest.restore?.ok && latest.restore?.sha256 === meta.sha256) existing.server_restore = latest.restore;
        await saveMetadata(metadataFile, existing);
        return existing;
      } catch { repair = true; }
      finally { await rm(temporaryRestored, { force: true }); }
    }
    await download(temporary);
    await encryptBackup(temporary, temporaryEncrypted, key, meta.sha256);
    await decryptBackup(temporaryEncrypted, temporaryRestored, key, meta.sha256);
    await rename(temporaryEncrypted, encrypted);
    const now = new Date().toISOString();
    const stored = { ...meta, copied_at: now, verified_at: now, encrypted_verified: true,
      encryption: 'AES-256-GCM', server_restore: latest.restore, ...(repair ? { repaired_at: now } : {}) };
    await saveMetadata(metadataFile, stored);
    const cutoff = Date.now() - 30 * 86400_000;
    for (const name of await readdir(backups)) {
      if (!name.endsWith('.dump.json') || !backupFilenamePattern.test(name.slice(0, -5)) || name === path.basename(metadataFile)) continue;
      const old = await metadataAt(path.join(backups, name));
      if (old.encrypted_verified && Date.parse(old.copied_at) < cutoff) {
        await rm(path.join(backups, name.slice(0, -5) + '.aes256gcm'), { force: true });
        await rm(path.join(backups, name), { force: true });
      }
    }
    return stored;
  } finally {
    for (const file of [temporary, temporaryEncrypted, temporaryRestored]) await rm(file, { force: true });
  }
}
