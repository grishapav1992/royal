import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptBackup, decryptBackup } from './offsite-crypto.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function validate(value, config) {
  if (!value || value.version !== 1 || value.network !== 'nile' || value.asset !== 'USDT_NILE_TEST'
    || value.configSha256 !== sha(JSON.stringify(config)) || !Array.isArray(value.bindings) || value.bindings.length > config.addresses.length
    || Object.keys(value).sort().join(',') !== 'asset,bindings,configSha256,network,version') throw new Error('invalid_nile_bindings_backup');
  const ids = new Set(), users = new Set();
  for (const row of value.bindings) {
    if (!row || Object.keys(row).sort().join(',') !== 'accountId,address,boundAt,userId'
      || typeof row.accountId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.accountId)
      || ids.has(row.accountId) || users.has(row.userId) || !Number.isSafeInteger(row.boundAt) || row.boundAt < 1 || row.boundAt > Date.now() + 30000
      || !config.addresses.some(a => a.userId === row.userId && a.address === row.address)) throw new Error('invalid_nile_bindings_backup');
    ids.add(row.accountId); users.add(row.userId);
  }
  return value;
}
export async function ensureNileBindingsCopy(latest, directory, key, config) {
  const manifest = validate(latest.manifest, config), serialized = JSON.stringify(manifest);
  if (latest.ok !== true || latest.testOnly !== true || latest.spendable !== false || latest.network !== 'nile'
    || latest.asset !== 'USDT_NILE_TEST' || latest.sha256 !== sha(serialized)) throw new Error('invalid_nile_bindings_backup');
  await mkdir(directory, { mode: 0o700, recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('unsafe_bindings_backup_path');
  const temporary = await mkdtemp(join(tmpdir(), 'royal-bindings-copy-'));
  const name = 'nile-bindings-' + latest.sha256 + '.json', target = join(directory, name + '.aes256gcm');
  const partial = target + '.' + randomBytes(6).toString('hex') + '.partial';
  try {
    const previousFile = join(directory, 'latest.json'); let previous;
    try { previous = JSON.parse(await readFile(previousFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      if (!/^[a-f0-9]{64}$/.test(previous.sha256) || previous.file !== 'nile-bindings-' + previous.sha256 + '.json') throw new Error('invalid_previous_bindings_backup');
      const restored = join(temporary, 'previous.json');
      await decryptBackup(join(directory, previous.file + '.aes256gcm'), restored, key, previous.sha256);
      const old = validate(JSON.parse(await readFile(restored, 'utf8')), config);
      if (old.bindings.some(row => !manifest.bindings.some(candidate => JSON.stringify(candidate) === JSON.stringify(row)))) throw new Error('nile_bindings_removed_or_reassigned');
    }
    let existing = false;
    try { const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe_bindings_backup_path'); existing = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const restored = join(temporary, 'current.json');
    if (!existing) {
      const plain = join(temporary, 'manifest.json');
      await writeFile(plain, serialized, { flag: 'wx', mode: 0o600 });
      await encryptBackup(plain, partial, key, latest.sha256);
      await decryptBackup(partial, restored, key, latest.sha256);
    } else await decryptBackup(target, restored, key, latest.sha256);
    if (JSON.stringify(validate(JSON.parse(await readFile(restored, 'utf8')), config)) !== serialized) throw new Error('bindings_restore_mismatch');
    if (!existing) await rename(partial, target);
    const result = { file: name, sha256: latest.sha256, bindings: manifest.bindings.length, verified_at: new Date().toISOString(), encrypted_verified: true };
    const meta = join(directory, name + '.json');
    await writeFile(meta + '.partial', JSON.stringify(result) + '\n', { mode: 0o600 }); await rename(meta + '.partial', meta);
    await writeFile(previousFile + '.partial', JSON.stringify(result) + '\n', { mode: 0o600 }); await rename(previousFile + '.partial', previousFile);
    return result;
  } finally { await rm(temporary, { recursive: true, force: true }); await rm(partial, { force: true }); }
}
