import { PostgresDatabase } from '../database';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NileTestLedger, type NileTestConfig } from './nile-test-ledger';
import { rejectTron } from './tron-protocol';
import type { NileDepositPool } from './nile-deposit-pool';

async function checksum(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyNileTestSnapshot(file: string, config: NileTestConfig, expected: string, pool?: NileDepositPool) {
  if (await checksum(file) !== expected) rejectTron('test_snapshot_checksum_mismatch');
  const database = await PostgresDatabase.restore(file);
  const restored = new NileTestLedger(database.schema, config, true, pool, database);
  try { await restored.ready; return await restored.audit(); }
  finally { await database.dropSchema(); await restored.close(); }
}
export async function snapshotNileTestLedger(ledger: NileTestLedger, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) rejectTron('unsafe_snapshot_path');
  const name = 'nile-credit-' + new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomBytes(4).toString('hex') + '.pg.json';
  const target = join(directory, name), temporary = target + '.partial';
  try {
    await ledger.ready;
    await ledger.db.snapshot(temporary);
    const sha256 = await checksum(temporary), checks = await verifyNileTestSnapshot(temporary, ledger.config, sha256,ledger.pool);
    await rename(temporary, target);
    const metadata = { ok: true, file: name, createdAt: new Date().toISOString(), sha256, config: ledger.config, checks };
    await writeFile(target + '.meta.json.partial', JSON.stringify(metadata) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(target + '.meta.json.partial', target + '.meta.json');
    await ledger.db.prepare('UPDATE state SET last_backup_at=? WHERE id=1').run(Date.now());
    for (const file of await readdir(directory)) {
      if (!/^nile-credit-\d{8}T\d{9}Z-[a-f0-9]{8}\.pg\.json\.meta\.json$/.test(file)) continue;
      const meta = JSON.parse(await readFile(join(directory, file), 'utf8'));
      if (meta.ok && meta.file === file.slice(0, -10) && Date.parse(meta.createdAt) < Date.now() - 14 * 86400000) {
        await rm(join(directory, meta.file), { force: true }); await rm(join(directory, file));
      }
    }
    return metadata;
  } finally { await rm(temporary, { force: true }); await rm(target + '.meta.json.partial', { force: true }); }
}
