import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve('.');
for (const path of ['package.json', 'package-lock.json', 'dist', 'dist-server/index.js']) assert.ok(existsSync(join(root, path)), `Missing build: ${path}`);
const workspace = mkdtempSync(join(tmpdir(), 'royal-games-production-smoke-'));
const safeEnvironment = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir() };
let application;
let serverOutput = '';
const run = async (command, args) => {
  const child = spawn(command, args, { cwd: workspace, env: safeEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `Isolated production install failed: ${output.slice(-2500)}`);
  return output;
};

try {
  for (const path of ['package.json', 'package-lock.json', 'dist', 'dist-server']) cpSync(join(root, path), join(workspace, path), { recursive: true });
  const userConfig = join(workspace, 'empty-user.npmrc'), globalConfig = join(workspace, 'empty-global.npmrc');
  writeFileSync(userConfig, ''); writeFileSync(globalConfig, '');
  await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`, '--registry=https://registry.npmjs.org']);
  const audit = JSON.parse(await run('npm', ['audit', '--json', `--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`, '--registry=https://registry.npmjs.org']));
  assert.equal(audit.metadata.vulnerabilities.total, 0, 'Known npm advisories must be resolved');
  assert.equal(existsSync(join(workspace, 'node_modules/@noble/hashes')), false, 'Demo games must start without dev-only hash helpers');
  assert.equal(existsSync(join(workspace, 'node_modules/tsx')), false, 'Production must not rely on tsx');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`, publicOrigin = 'https://royal-production-smoke.invalid';
  application = spawn(process.execPath, ['dist-server/index.js'], {
    cwd: workspace, env: { ...safeEnvironment, PORT: String(port), AUTH_DB_PATH: ':memory:', NODE_ENV: 'production', PUBLIC_ORIGIN: publicOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  application.stdout.on('data', data => { serverOutput += data; });
  application.stderr.on('data', data => { serverOutput += data; });
  const deadline = Date.now() + 15000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (application.exitCode !== null) throw new Error(`Production server failed: ${serverOutput.slice(-2500)}`);
    try { healthy = (await fetch(origin + '/healthz')).ok; if (healthy) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(healthy, 'Production server must become healthy');
  const headers = { Origin: publicOrigin, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' };
  const login = await fetch(origin + '/api/auth/login', {
    method: 'POST', headers, body: JSON.stringify({ email: `production-smoke-${randomUUID()}@example.test`, password: 'Only-synthetic-smoke-password!' }),
  });
  assert.equal(login.status, 200);
  const account = (await login.json()).account;
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authorized = { ...headers, Cookie: cookie, 'X-Royal-Account-Id': account.id };
  const post = async (path, body) => {
    const response = await fetch(origin + path, { method: 'POST', headers: authorized, body: JSON.stringify(body) });
    assert.equal(response.status, 200, `${path} must work with production dependencies`);
    return response.json();
  };
  await post('/api/demo-wallet/operations', { id: randomUUID(), kind: 'deposit', amount: 1000 });
  const round = await post('/api/demo-wallet/operations', { id: randomUUID(), kind: 'play', gameId: 'royal-limbo', rulesVersion: 1, amount: 10, input: { targetMultiplier: 1.13 } });
  assert.equal(round.gameRound.gameId, 'royal-limbo');
  assert.equal(round.gameRound.stakeUnits, '1000');
  assert.equal(Math.round(round.wallet.balance * 100), 99000 + Number(round.gameRound.payoutUnits));
  const mines = await post('/api/demo-wallet/mines', { id: randomUUID(), action: 'start', amount: 10, mineCount: 1 });
  assert.equal(mines.session.state, 'active');
  assert.equal(Object.hasOwn(mines.session, 'mineCells'), false);
  mkdirSync(join(root, 'artifacts/game-security'), { recursive: true });
  const proof = { checkedAt: new Date().toISOString(), node: process.version, serverBundleSha256: createHash('sha256').update(readFileSync(join(workspace, 'dist-server/index.js'))).digest('hex'), productionDependenciesOnly: true, installScriptsDisabled: true, projectSecretsCopied: false, npmAudit: audit.metadata, health: true, limboSettlement: true, minesStart: true };
  writeFileSync(join(root, 'artifacts/game-security/production-smoke.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  if (application && application.exitCode === null) {
    const exited = once(application, 'exit');
    application.kill('SIGTERM'); await exited;
  }
  rmSync(workspace, { recursive: true, force: true });
}
