import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { temporaryDatabase } from '../scripts/database-test';

test('temporary database cleanup removes its files even after an external process-group shutdown', { timeout: 30000 }, async () => {
  const database = await temporaryDatabase();
  try {
    const pid = Number((await readFile(join(database.directory, 'postmaster.pid'), 'utf8')).split('\n')[0]);
    assert(Number.isSafeInteger(pid) && pid > 1);
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await Promise.race([database.cleanup(), new Promise((_, reject) => setTimeout(() => reject(Error('Cleanup timed out')), 5000).unref())]);
    await assert.rejects(stat(database.directory), { code: 'ENOENT' });
    await database.cleanup();
  } finally { await database.cleanup(); }
});
