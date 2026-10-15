import { constants } from 'node:fs';
import { lstat, open, realpath, unlink, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TEST = /^tests\/[A-Za-z0-9][A-Za-z0-9_-]*\.spec\.ts$/;

export function browserTestSelection(task, available) {
  const selected = new Set((task.artifact?.developer?.changed_files || []).filter(path => TEST.test(path) && available.includes(path)));
  const changed = task.artifact?.developer?.changed_files || [];
  if (changed.some(path => /(?:demoWallet|game-wallet|casino-api-pro|wallet-account)/i.test(path)) && available.includes('tests/demo-wallet.spec.ts')) selected.add('tests/demo-wallet.spec.ts');
  if (!selected.size && available.includes('tests/game-core.spec.ts')) selected.add('tests/game-core.spec.ts');
  return [...selected].sort().slice(0, 8);
}

// Only the trusted controller sees this queue. Model commands cannot access its mount.
export async function browserCheck({ task, candidate, tests, directory = process.env.BROWSER_CHECKS_DIR, signal, timeoutMs = 660000 }) {
  if (!UUID.test(task.id) || !/^[a-f0-9]{40}$/.test(candidate) || !Number.isSafeInteger(task.requirements_version)
    || task.requirements_version < 1 || !Array.isArray(tests) || !tests.length || tests.length > 8 || tests.some(path => !TEST.test(path))
    || new Set(tests).size !== tests.length || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 660000) throw new Error('Invalid browser check request');
  const failed = detail => ({ name: 'Браузерные проверки в отдельной среде', passed: false, verification_blocked: true, detail });
  if (!directory) return failed('Среда браузерных проверок не подключена. Проверка не выполнена.');
  if (signal?.aborted) throw signal.reason || new Error('Browser check cancelled');
  const root = resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new Error('Browser queue must be a canonical directory');
  const request = { request_id: randomUUID(), task_id: task.id, candidate_commit: candidate, requirements_version: task.requirements_version, tests };
  const requestPath = join(root, `${request.request_id}.request.json`);
  const responsePath = join(root, `${request.request_id}.response.json`);
  const temporary = `${requestPath}.tmp`;
  let complete = false;
  try {
    await writeFile(temporary, JSON.stringify(request), { flag: 'wx', mode: 0o644 });
    await rename(temporary, requestPath);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason || new Error('Browser check cancelled');
      let handle;
      try { handle = await open(responsePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (handle) {
        let result;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) throw new Error('Invalid browser response file');
          result = JSON.parse(await handle.readFile('utf8'));
        } finally { await handle.close(); }
        if (Object.keys(request).some(key => JSON.stringify(result[key]) !== JSON.stringify(request[key]))
          || !['completed', 'error', 'timeout', 'cancelled'].includes(result.status) || typeof result.passed !== 'boolean'
          || typeof result.detail !== 'string' || !result.detail.trim() || result.detail.length > 16000
          || (result.passed && (result.status !== 'completed' || result.exit_code !== 0))) throw new Error('Browser result does not match this candidate');
        complete = true;
        return { name: 'Браузерные проверки в отдельной среде', passed: result.passed,
          verification_blocked: result.status !== 'completed', detail: result.detail.slice(-8192) };
      }
      await delay(500, undefined, { signal });
    }
    return failed('Среда браузерных проверок не ответила за отведенное время. Проверка не завершена.');
  } finally {
    if (!complete) await writeFile(join(root, `${request.request_id}.cancel`), '', { flag: 'wx', mode: 0o644 }).catch(() => {});
    await unlink(requestPath).catch(() => {});
    await Promise.all([unlink(temporary).catch(() => {}), unlink(responsePath).catch(() => {})]);
  }
}
