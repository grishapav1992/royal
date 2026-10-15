import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installLoopbackNetworking } from './load-server-metrics';
import { parseStandManifest } from './load-stand-contract';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function bounded<T>(work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Smoke timeout')), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function forwarding() {
  let target: number | undefined;
  const sockets = new Set<Socket>();
  const own = (socket: Socket) => { socket.setNoDelay(true); sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  const server = createServer(socket => {
    own(socket);
    if (!target) { socket.destroy(); return; }
    const upstream = connect(target, '127.0.0.1'); own(upstream);
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    upstream.once('close', () => socket.destroy()); socket.once('close', () => upstream.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: (server.address() as { port: number }).port, to: (port: number) => { target = port; },
    close: async () => { for (const socket of sockets) socket.destroy(); await bounded(new Promise<void>(resolve => server.close(() => resolve())), 3000); } };
}
function child(args: string[], env: NodeJS.ProcessEnv) {
  const processChild = spawn(process.execPath, args, { env, stdio: ['ignore', 'ignore', 'ignore'] });
  const done = new Promise<number>((resolve, reject) => { processChild.once('error', reject); processChild.once('exit', code => resolve(code ?? 1)); });
  void done.catch(() => {});
  return { child: processChild, done };
}
async function stop(processChild: ChildProcess) {
  if (processChild.exitCode !== null || processChild.signalCode !== null) return;
  const done = new Promise<void>(resolve => processChild.once('exit', () => resolve()));
  processChild.kill('SIGTERM');
  try { await bounded(done, 20000); return; } catch {}
  processChild.kill('SIGKILL'); await bounded(done, 2000);
}
async function run() {
  if (process.argv.includes('--help')) {
    console.log('Temporary database wrapper required: node --import tsx scripts/database-test.ts --import tsx scripts/load-stand-smoke.ts --proxy-binary /path/to/caddy --output-dir artifacts/websocket-stand/smoke-new'); return;
  }
  const values: Record<string, string> = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index], value = process.argv[++index];
    if (!['--proxy-binary', '--output-dir', '--server-bundle'].includes(key) || !value || values[key]) throw new Error('Invalid smoke arguments'); values[key] = value;
  }
  if (process.env.NODE_ENV !== 'test' || process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'royal_test') throw new Error('Temporary database wrapper required');
  if (!values['--proxy-binary']) throw new Error('Native test proxy required');
  const output = resolve(values['--output-dir'] ?? 'artifacts/websocket-stand/smoke-' + Date.now());
  await mkdir(output, { recursive: false });
  installLoopbackNetworking();
  const source = await readFile(resolve(values['--server-bundle'] ?? 'dist-server/index.js'));
  const bundle = join(output, 'server-bundle.js'); await writeFile(bundle, source, { flag: 'wx' });
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'NODE_ENV', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'ROYAL_REDIS_SERVER_BINARY']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const results: object[] = [], processes: ChildProcess[] = [];
  const interrupt = () => { for (const processChild of processes) processChild.kill('SIGTERM'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    for (const inputMode of ['stress', 'browser-window']) {
      const directory = await mkdtemp(join(tmpdir(), 'royal-stand-smoke-'));
      const fixture = join(directory, 'stand.json'), api = await forwarding(), control = await forwarding();
      let server: ReturnType<typeof child> | undefined, generator: ReturnType<typeof child> | undefined;
      try {
        const serverOutput = join(output, inputMode + '-server.json'), generatorOutput = join(output, inputMode + '-generators.json');
        const proxyKind = inputMode === 'stress' ? 'node-tcp' : 'native-caddy';
        server = child(['--import', 'tsx', 'scripts/load-websocket-cluster.ts', '--server-bundle', bundle,
          '--stand-manifest', fixture, '--client-origin', 'http://127.0.0.1:' + api.port, '--clients', '8', '--seconds', '5',
          '--input-mode', inputMode, '--frame-diagnostics', '--output', serverOutput,
          ...(proxyKind === 'native-caddy' ? ['--proxy-binary', values['--proxy-binary']] : [])], env);
        processes.push(server.child);
        const until = performance.now() + 45000;
        for (;;) {
          try { if ((await stat(fixture)).isFile()) break; } catch {}
          if (server.child.exitCode !== null || server.child.signalCode !== null || performance.now() >= until) throw new Error('Stand fixture unavailable');
          await delay(50);
        }
        const manifest = parseStandManifest(JSON.parse(await readFile(fixture, 'utf8')));
        assert.equal((await stat(fixture)).mode & 0o077, 0);
        assert.notEqual(api.port, manifest.serverApiPort); assert.notEqual(control.port, manifest.serverControlPort);
        api.to(manifest.serverApiPort); control.to(manifest.serverControlPort);
        generator = child(['--import', 'tsx', 'scripts/load-websocket-generators.ts', '--manifest', fixture,
          '--control-port', String(control.port), '--workers', '4', '--input-mode', inputMode, '--output', generatorOutput], env);
        processes.push(generator.child);
        assert.equal(await bounded(generator.done, 60000), 0, 'Generator verdict failed');
        assert.equal(await bounded(server.done, 20000), 0, 'Stand verdict failed');
        const serverReport = JSON.parse(await readFile(serverOutput, 'utf8'));
        const generatorReport = JSON.parse(await readFile(generatorOutput, 'utf8'));
        assert.equal(serverReport.ok, true); assert.equal(generatorReport.ok, true);
        assert.equal(serverReport.cleanup.passed, true); assert.equal(generatorReport.cleanup.passed, true);
        assert.deepEqual(generatorReport.attestation, { control: true, gameApi: true, verifiedBeforeGenerators: true });
        assert.equal(serverReport.inputDelivery.sentFrames, serverReport.inputDelivery.receivedFrames);
        assert.equal(serverReport.differentReportedHosts, false);
        assert.equal(serverReport.summary.connectedClients, 8);
        assert.equal(serverReport.generators.length, 4);
        assert.ok(serverReport.generators.every((item: any) => item.ackMs.sampleCount > 0 && item.tracking.latencyTimingSamplesDropped === 0));
        await assert.rejects(stat(fixture), { code: 'ENOENT' });
        results.push({ inputMode, proxyKind, ok: true, summary: serverReport.summary, inputDelivery: serverReport.inputDelivery,
          sourceSha256: serverReport.bundle.sha256, privateManifestRemoved: true });
      } finally {
        if (generator) await stop(generator.child); if (server) await stop(server.child);
        await api.close(); await control.close(); await rm(directory, { recursive: true, force: true });
      }
    }
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await Promise.all(processes.map(stop));
  }
  const verification = { ok: true, purpose: 'Two-runner workflow and forwarded loopback origin verification only',
    physicalHosts: 1, productionTraffic: false, capacity1000Proven: false, clientsPerSmoke: 8,
    frozenBundleSha256: createHash('sha256').update(source).digest('hex'), results };
  await writeFile(join(output, 'verification.json'), JSON.stringify(verification, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, ok: true, runs: results.length, capacity1000Proven: false }));
}
void run().catch(() => { console.error(JSON.stringify({ ok: false, code: 'stand-smoke-failed' })); process.exitCode = 1; });
