import { PostgresDatabase } from '../database';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, rename, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rejectTron } from './tron-protocol';
import { TronReadStore, type ReaderConfig } from './tron-store';

async function checksum(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyTronSnapshot(file: string, config: ReaderConfig, expectedSha256: string) {
  if (await checksum(file) !== expectedSha256) rejectTron('snapshot_checksum_mismatch');
  const database = await PostgresDatabase.restore(file);
  const restored = new TronReadStore(database.schema, config, true, database);
  try { await restored.ready; return await restored.audit(); }
  finally { await database.dropSchema(); await restored.close(); }
}
export async function snapshotTronStore(store: TronReadStore, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) rejectTron('unsafe_snapshot_path');
  const stamp = new Date().toISOString().replace(/[-:.]/g, ''), name = 'nile-' + stamp + '-' + randomBytes(4).toString('hex') + '.pg.json';
  const target = join(directory, name), temporary = target + '.partial';
  try {
    await store.ready;
    await store.db.snapshot(temporary);
    const sha256 = await checksum(temporary), checks = await verifyTronSnapshot(temporary, store.config, sha256);
    await rename(temporary, target);
    const metadata = { ok: true, file: name, sha256, createdAt: new Date().toISOString(), config: store.config, checks };
    await writeFile(target + '.meta.json.partial', JSON.stringify(metadata) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(target + '.meta.json.partial', target + '.meta.json');
    await store.db.prepare('UPDATE reader_state SET last_backup_at=? WHERE id=1').run(Date.now());
    const cutoff = Date.now() - 14 * 86400000;
    for (const file of await readdir(directory)) {
      if (!/^nile-\d{8}T\d{9}Z-[a-f0-9]{8}\.pg\.json\.meta\.json$/.test(file)) continue;
      const meta = JSON.parse(await readFile(join(directory, file), 'utf8'));
      if (meta.ok && Date.parse(meta.createdAt) < cutoff && meta.file === file.slice(0, -10)) {
        await rm(join(directory, meta.file), { force: true }); await rm(join(directory, file));
      }
    }
    return metadata;
  } finally {
    await rm(temporary, { force: true }); await rm(target + '.meta.json.partial', { force: true });
  }
}
