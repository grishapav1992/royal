import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createStandControl, type StandAbortCode } from '../scripts/load-stand-control';
import { standHost, STAND_ROLE, type StandManifest } from '../scripts/load-stand-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

for (const mode of ['missing-api-attestation', 'wrong-api-run'] as const) {
  test(`the real generator refuses ${mode} before sending session cookies or spawning SDK clients`, { timeout: 15000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'royal-stand-isolation-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const sockets = new Set<Socket>(), paths: string[] = [];
    let cookies = 0, matchmaking = 0;
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', secret = hash('isolated-control-only'), bundleSha256 = hash('isolated-test-bundle');
    const createdAt = Date.now(), expiresAt = createdAt + 60000, serverHost = standHost();
    const api = createServer((request, response) => {
      paths.push(request.url!);
      if (request.headers.cookie) cookies++;
      if (request.url?.startsWith('/matchmake')) matchmaking++;
      response.setHeader('content-type', 'application/json');
      if (request.url === '/__load-stand/status' && mode === 'missing-api-attestation') {
        response.statusCode = 404; response.end(JSON.stringify({ error: 'unknown-route' })); return;
      }
      if (request.url === '/__load-stand/status') {
        response.end(JSON.stringify({ protocol: 1, role: STAND_ROLE, runId: 'different-run', expiresAt, bundleSha256,
          clients: 4, seconds: 1, serverHost, apiEndpoint: endpoint })); return;
      }
      // A regular application health response cannot attest a load-test API origin.
      response.end(JSON.stringify({ ok: true, service: 'production-like-fixture' }));
    });
    api.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    api.listen(0, '127.0.0.1'); await once(api, 'listening');
    t.after(() => new Promise<void>(yes => { api.close(() => yes()); for (const socket of sockets) socket.destroy(); }));
    const address = api.address(); assert(address && typeof address !== 'string');
    const endpoint = 'http://127.0.0.1:' + address.port, aborts: StandAbortCode[] = [];
    const control = await createStandControl({ runId, secret, expiresAt,
      status: { clients: 4, seconds: 1, apiEndpoint: endpoint, bundleSha256, serverHost }, onAbort: code => { aborts.push(code); },
      validatePrepared: () => { throw new Error('unexpected-preparation'); }, validateResults: () => { throw new Error('unexpected-results'); } });
    t.after(() => control.close());
    const manifest: StandManifest = { protocol: 1, role: STAND_ROLE, runId, secret, createdAt, expiresAt, apiEndpoint: endpoint,
      controlEndpoint: 'http://127.0.0.1:' + control.port, serverApiPort: address.port, serverControlPort: control.port,
      bundleSha256, clients: 4, seconds: 1, serverHost, tokens: Array.from({ length: 4 }, (_, i) => hash('synthetic-only-' + i)) };
    const manifestPath = join(directory, 'private-manifest.json'), output = join(directory, 'generator-report.json');
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key] !== undefined) env[key] = process.env[key];
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/load-websocket-generators.ts'), '--manifest', manifestPath,
      '--workers', '1', '--output', output], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let childOutput = '';
    for (const stream of [child.stdout, child.stderr]) stream!.on('data', data => { childOutput = (childOutput + data.toString()).slice(-65536); });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    let code: number | null;
    try { [code] = await exited as [number | null, NodeJS.Signals | null]; } finally { clearTimeout(timer); }
    assert.equal(code, 1);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.ok, false); assert.equal(report.verdict, 'generator-or-stand-failure');
    assert.deepEqual(report.childExits, []); assert.deepEqual(report.cleanup, { passed: true, failures: [] });
    assert.equal(cookies, 0); assert.equal(matchmaking, 0); assert.deepEqual(paths, ['/__load-stand/status']);
    assert.deepEqual(aborts, ['generator-aborted']);
    await assert.rejects(control.prepared); await assert.rejects(control.results);
    const publicOutput = childOutput + JSON.stringify(report);
    for (const credential of [secret, ...manifest.tokens]) assert(!publicOutput.includes(credential));
  });
}
