import { spawn } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const next = path + '.pending-' + randomUUID();
  await writeFile(next, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(next, path);
}

export async function run(command, args, root = projectRoot) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(Error(`${command} failed (${signal ?? code})`)));
  });
}

export async function buildApplication({ root = projectRoot, modules = null } = {}) {
  const report = { format: 1, startedAt: new Date().toISOString(), scope: modules ? 'modules' : 'application', steps: [] };
  const started = performance.now();
  const step = async (name, action) => {
    const start = performance.now();
    const row = { name, passed: false };
    report.steps.push(row);
    try { await action(); row.passed = true; }
    finally { row.durationMs = Math.round(performance.now() - start); }
  };
  try {
    const node = args => () => run(process.execPath, args, root);
    await step('rtp', node(['scripts/check-game-rtp.mjs']));
    await step('typecheck', node(['node_modules/typescript/bin/tsc', '--noEmit']));
    await step('modules', node(['scripts/build-game-module.mjs', ...(modules ? ['--games', ...modules] : ['--all'])]));
    if (!modules) {
      await step('host', node(['node_modules/vite/bin/vite.js', 'build']));
      for (const [name, input, output] of [
        ['backend', 'server/index.ts', 'index.js'],
        ['reconciliation', 'scripts/crypto-reconcile.ts', 'crypto-reconcile.js'],
        ['payments', 'server/payments/index.ts', 'payments.js'],
      ]) await step(name, () => build({ absWorkingDir: root, entryPoints: [input], bundle: true,
        platform: 'node', packages: 'external', format: 'esm', outfile: 'dist-server/' + output }));
    }
    report.passed = true;
    return report;
  } finally {
    report.passed ??= false;
    report.durationMs = Math.round(performance.now() - started);
    await saveJson(resolve(root, 'module-build/application-report.json'), report);
    console.log(JSON.stringify({ applicationBuild: report }));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await buildApplication();
}
