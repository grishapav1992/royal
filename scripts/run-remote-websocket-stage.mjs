import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const inactive = ['created', 'exited', 'dead', 'missing'];
const pause = ms => new Promise(done => setTimeout(done, ms));
class StageError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new StageError(code); };
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const sameProduction = (left, right) => ['game', 'caddy'].every(service => ['Id', 'Image', 'StartedAt']
  .every(key => typeof left?.[service]?.[key] === 'string' && left[service][key] === right?.[service]?.[key]));
const relativeFile = value => typeof value === 'string' && /^[a-zA-Z0-9_./-]{1,160}$/.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');

export function validateRemoteStagePlan(value) {
  if (!value || value.protocol !== 1 || typeof value.runId !== 'string' || !/^s8-[a-zA-Z0-9_-]{8,48}$/.test(value.runId)
    || value.ownedRoot !== '/opt/royal-load-' + value.runId || value.containerName !== 'royal-load-' + value.runId + '-test') fail('invalid-owned-stage-plan');
  const { ssh, stage, localPorts, supervisor, artifacts, production } = value;
  if (!ssh || ssh.host !== 'root@45.192.12.242' || ssh.port !== 22
    || ssh.identityFile !== join(homedir(), '.ssh', 'royal_server_ed25519')) fail('unapproved-ssh-target');
  if (!stage || ![100, 250, 500, 1000, 1200].includes(stage.clients) || !integer(stage.seconds, 1, 1800)
    || stage.inputMode !== 'browser-window' || stage.workers !== 4
    || (stage.sdkWebSocket ?? 'ws') !== 'ws') fail('invalid-stage-workload');
  if (!localPorts || !integer(localPorts.api, 1024, 65535) || !integer(localPorts.control, 1024, 65535)
    || localPorts.api === localPorts.control) fail('invalid-local-forward-ports');
  if (!supervisor || supervisor.path !== 'load-remote-stand.py' || !hex.test(supervisor.sha256)
    || (value.remotePlanPath ?? 'stand-plan.json') !== 'stand-plan.json') fail('invalid-supervisor-handoff');
  if (!hex.test(value.bundleSha256) || !hex.test(value.runtimeSha256) || value.runtimeArchive !== 'offline-runtime.tar.gz'
    || value.frozenServer !== 'frozen-server.mjs') fail('invalid-frozen-runtime-plan');
  const runtimeFiles = ['frozen-server.mjs', 'dist-load/cluster.mjs', 'dist-load/database.mjs', 'dist-load/metrics.mjs',
    'dist-load/metadata.json', 'runtime-check.mjs', 'bin/caddy', 'bin/redis-server'];
  if (!hex.test(value.guardSha256) || !value.runtimeFiles || Object.keys(value.runtimeFiles).length !== runtimeFiles.length
    || runtimeFiles.some(path => !hex.test(value.runtimeFiles[path])) || value.runtimeFiles['frozen-server.mjs'] !== value.bundleSha256) fail('invalid-runtime-file-digests');
  const stem = 'run/stage-' + stage.clients;
  if (value.manifestPath !== stem + '-private.json' || !artifacts || artifacts.server !== stem + '-server.json'
    || artifacts.guard !== stem + '-guard.json' || artifacts.guardSamples !== stem + '-guard.jsonl'
    || artifacts.supervisor !== stem + '-supervisor.json' || Object.keys(artifacts).length !== 4
    || Object.values(artifacts).some(path => !relativeFile(path))) fail('invalid-stage-artifact-paths');
  for (const service of ['game', 'caddy']) {
    const container = production?.[service];
    if (!container || !hex.test(container.Id) || !/^sha256:[a-f0-9]{64}$/.test(container.Image)
      || typeof container.StartedAt !== 'string' || !/^[0-9T:.+Z-]{20,64}$/.test(container.StartedAt)) fail('invalid-production-baseline');
  }
  if (typeof value.outputDir !== 'string' || !isAbsolute(value.outputDir) || resolve(value.outputDir) !== value.outputDir
    || value.startStand !== undefined && typeof value.startStand !== 'boolean') fail('invalid-local-stage-output');
  return { ...value, remotePlanPath: 'stand-plan.json', startStand: value.startStand === true,
    stage: { ...stage, workers: stage.workers ?? 4, sdkWebSocket: stage.sdkWebSocket ?? 'ws' } };
}

/** A timeout terminates the whole owned process group, including SDK subprocesses. */
export function boundedCommand(program, args, { timeoutMs, signal, input, maximum = 1024 * 1024, cwd = project } = {}) {
  if (!integer(timeoutMs, 1, 2700000)) return Promise.reject(new StageError('invalid-command-timeout'));
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key] !== undefined) env[key] = process.env[key];
  return new Promise((done, reject) => {
    const child = spawn(program, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; let bytes = 0, failure, termTimer, finalTimer, groupTimer, settled = false, closed;
    const kill = sig => { if (child.pid) try { process.kill(-child.pid, sig); } catch (error) { if (error.code !== 'ESRCH') failure ??= 'owned-process-stop-unconfirmed'; } };
    const groupAlive = () => { if (!child.pid) return false; try { process.kill(-child.pid, 0); return true; }
      catch (error) { return error.code !== 'ESRCH'; } };
    const finish = (code, sig) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(termTimer); clearTimeout(finalTimer); clearInterval(groupTimer); signal?.removeEventListener('abort', abort);
      if (failure) reject(new StageError(failure)); else done({ code, signal: sig, stdout: Buffer.concat(output), stderrBytes });
    };
    const stop = reason => {
      if (failure) return; failure = reason; kill('SIGTERM');
      termTimer = setTimeout(() => { kill('SIGKILL'); finalTimer = setTimeout(() => {
        if (groupAlive()) failure = 'owned-process-stop-unconfirmed'; finish(null, 'SIGKILL');
      }, 2000); }, 10000);
    };
    const abort = () => stop('local-stage-interrupted');
    const timer = setTimeout(() => stop('bounded-command-timeout'), timeoutMs);
    let stderrBytes = 0;
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > maximum) stop('command-output-limit'); else output.push(chunk); });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > maximum) stop('command-error-output-limit'); });
    child.stdin.on('error', () => {});
    child.once('error', () => { failure ??= 'local-command-spawn-failed'; finish(null, null); });
    child.once('close', (code, sig) => {
      closed = [code, sig];
      if (!groupAlive()) { finish(code, sig); return; }
      if (!failure) stop('owned-process-group-outlived-command');
      groupTimer = setInterval(() => { if (!groupAlive()) finish(...closed); }, 100);
    });
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.end(input); if (signal?.aborted) abort();
  });
}
async function stopTunnel(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  const exited = new Promise(done => child.once('close', () => done(true)));
  const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw new StageError('tunnel-stop-unconfirmed'); } };
  let timer;
  try {
    kill('SIGTERM');
    if (await Promise.race([exited, new Promise(done => { timer = setTimeout(() => done(false), 5000); })])) return true;
  } finally { clearTimeout(timer); }
  kill('SIGKILL');
  try { return await Promise.race([exited, new Promise(done => { timer = setTimeout(() => done(false), 2000); })]); }
  finally { clearTimeout(timer); }
}
async function availablePort(port) {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', () => reject(new StageError('local-forward-port-unavailable'))); server.listen(port, '127.0.0.1', done); });
  await new Promise(done => server.close(done));
}
const sshArguments = plan => ['-F', '/dev/null', '-i', plan.ssh.identityFile, '-p', '22', '-T',
  '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no',
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlMaster=no', '-o', 'ControlPath=none'];
function attestationCode(plan) {
  const keys = ['protocol', 'runId', 'ownedRoot', 'containerName', 'bundleSha256', 'runtimeSha256', 'runtimeArchive', 'frozenServer',
    'manifestPath', 'artifacts', 'production', 'guardSha256', 'runtimeFiles', 'localPorts', 'supervisor'];
  const expected = Object.fromEntries(keys.map(key => [key, plan[key]]));
  expected.stage = Object.fromEntries(['clients', 'seconds', 'inputMode', 'workers'].map(key => [key, plan.stage[key]]));
  return `import hashlib,json,os,stat,subprocess,sys\nfrom pathlib import Path\nroot=Path(${JSON.stringify(plan.ownedRoot)})\nhelper=root/${JSON.stringify(plan.supervisor.path)}\nremote_plan=root/${JSON.stringify(plan.remotePlanPath)}\nif root.resolve()!=root or root.is_symlink() or not root.is_dir() or root.stat().st_uid!=0 or stat.S_IMODE(root.stat().st_mode)!=0o700: raise RuntimeError('owned-root-mismatch')\nmarker=root/'owner'\nif marker.is_symlink() or not marker.is_file() or marker.stat().st_size>128 or marker.read_text().strip()!=${JSON.stringify(plan.runId)}: raise RuntimeError('owner-marker-mismatch')\nif helper.is_symlink() or not helper.is_file() or helper.stat().st_size>1048576 or hashlib.sha256(helper.read_bytes()).hexdigest()!=${JSON.stringify(plan.supervisor.sha256)}: raise RuntimeError('supervisor-digest-mismatch')\nif remote_plan.is_symlink() or not remote_plan.is_file() or remote_plan.stat().st_uid!=0 or stat.S_IMODE(remote_plan.stat().st_mode)!=0o600 or remote_plan.stat().st_size>65536: raise RuntimeError('private-remote-plan-required')\nexpected=json.loads(${JSON.stringify(JSON.stringify(expected))})\nvalue=json.loads(remote_plan.read_bytes())\nactual={key:value.get(key) for key in expected}\nactual['stage']={key:value.get('stage',{}).get(key) for key in expected['stage']}\nif actual!=expected: raise RuntimeError('remote-operational-plan-mismatch')\n`;
}
async function remoteAction(plan, action, grace, signal) {
  if (!['status', 'start', 'stop', 'cleanup-fixture'].includes(action)) fail('invalid-supervisor-action');
  const timeout = action === 'start' || action === 'stop' ? 90000 : 30000;
  const code = attestationCode(plan) + `args=['python3',str(helper),${JSON.stringify(action)},'--plan',str(remote_plan)]\n` +
    (action === 'stop' ? `args+=['--grace',${JSON.stringify(String(grace))}]\n` : '') +
    `reply=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,timeout=${action === 'start' ? 75 : Math.floor(timeout / 1000) - 3},env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8'})\nif reply.returncode!=0 or len(reply.stdout)>65536: raise RuntimeError('supervisor-action-failed')\nsys.stdout.buffer.write(reply.stdout)\n`;
  const result = await boundedCommand('ssh', [...sshArguments(plan), plan.ssh.host, 'python3', '-'], { input: code, timeoutMs: timeout, signal, maximum: 65536 });
  if (result.code !== 0) fail('owned-supervisor-command-failed');
  try { return JSON.parse(result.stdout.toString('utf8')); } catch { fail('invalid-supervisor-response'); }
}
async function remoteFile(plan, path, privateFile, signal) {
  const maximum = privateFile ? 2 * 1024 * 1024 : 16 * 1024 * 1024;
  const code = attestationCode(plan) + `path=root/${JSON.stringify(path)}\nif path.resolve()!=path or not path.is_relative_to(root): raise RuntimeError('artifact-path-mismatch')\nfd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)\ninfo=os.fstat(fd)\nif not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>${maximum}${privateFile ? ' or stat.S_IMODE(info.st_mode)!=0o600' : ''}: raise RuntimeError('bounded-artifact-file-required')\nwith os.fdopen(fd,'rb') as source: data=source.read(${maximum + 1})\nif len(data)>${maximum}: raise RuntimeError('artifact-size-changed')\nsys.stdout.buffer.write(data)\n`;
  const result = await boundedCommand('ssh', [...sshArguments(plan), plan.ssh.host, 'python3', '-'], { input: code, timeoutMs: 30000, signal, maximum });
  if (result.code !== 0) fail('remote-artifact-unavailable');
  return result.stdout;
}
async function productionSnapshot(plan, signal) {
  const code = attestationCode(plan) + `result={}\nfor service in ['game','caddy']:\n reply=subprocess.run(['docker','inspect','--type','container','--format','{{json .Id}}\\n{{json .Image}}\\n{{json .State.StartedAt}}','royal-'+service+'-1'],capture_output=True,text=True,timeout=10)\n if reply.returncode!=0 or len(reply.stdout)>1024: raise RuntimeError('production-snapshot-unavailable')\n values=list(map(json.loads,reply.stdout.splitlines()))\n if len(values)!=3: raise RuntimeError('invalid-production-snapshot')\n result[service]=dict(zip(['Id','Image','StartedAt'],values))\nprint(json.dumps(result,separators=(',',':')))\n`;
  const reply = await boundedCommand('ssh', [...sshArguments(plan), plan.ssh.host, 'python3', '-'], { input: code, timeoutMs: 30000, signal, maximum: 4096 });
  if (reply.code !== 0) fail('production-snapshot-unavailable');
  try { return JSON.parse(reply.stdout.toString('utf8')); } catch { fail('invalid-production-snapshot'); }
}
function ownedStatus(plan, status, expectedId) {
  if (!status || status.runId !== plan.runId || status.container !== plan.containerName || !hex.test(status.containerId)
    || expectedId && status.containerId !== expectedId || status.bundleSha256 !== plan.bundleSha256) fail('owned-stand-status-mismatch');
  if (['exited', 'dead', 'paused', 'restarting', 'removing'].includes(status.state) || ['ended', 'failed'].includes(status.phase)) fail('stand-ended-before-ready');
  if (status.ready === true && (status.state !== 'running' || status.guardActive !== true || !hex.test(status.manifestSha256)
    || !integer(status.serverApiPort, 1024, 65535) || !integer(status.serverControlPort, 1024, 65535)
    || status.serverApiPort === status.serverControlPort || !/^[a-f0-9-]{36}$/.test(status.standRunId))) fail('invalid-owned-stand-ready');
}
async function contract() {
  const { tsImport } = await import('tsx/esm/api');
  const module = await tsImport('./load-stand-contract.ts', import.meta.url);
  (await tsImport('./load-server-metrics.ts', import.meta.url)).installLoopbackNetworking();
  return module;
}
async function attestLocal(manifest, controlPort, verify, signal) {
  for (const [endpoint, path] of [['http://127.0.0.1:' + controlPort, '/status'], [manifest.apiEndpoint, '/__load-stand/status']]) {
    const response = await fetch(endpoint + path, { headers: { Authorization: 'Bearer ' + manifest.secret }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 65536) fail('local-stand-attestation-failed');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length;
      if (bytes > 65536) fail('local-attestation-response-limit'); chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    verify(JSON.parse(Buffer.concat(chunks).toString('utf8')), manifest);
  }
}

export function assessRemoteStage(plan, outcome, reports) {
  const { server, generator, guard, guardSamples, supervisor } = reports;
  const checks = {
    orchestrationCompleted: !outcome.failure && outcome.generatorExitCode === 0,
    attestationCompleted: /^[a-f0-9-]{36}$/.test(outcome.standRunId ?? '') && outcome.attestation?.manifestDigest === true
      && outcome.attestation?.control === true && outcome.attestation?.gameApi === true && outcome.attestation?.beforeGenerators === true,
    requiredArtifactsAvailable: !(outcome.missingArtifacts?.length) && !!server && !!generator && !!guard && !!supervisor && Array.isArray(guardSamples),
    serverChecksPassed: server?.ok === true && server.productionTraffic === false && server.targetClients === plan.stage.clients
      && server.measurementSeconds === plan.stage.seconds && server.cleanup?.passed === true && server.bundle?.sha256 === plan.bundleSha256
      && server.stand?.runId === outcome.standRunId && Object.keys(server.checks ?? {}).length > 0 && Object.values(server.checks ?? {}).every(value => value === true),
    generatorChecksPassed: generator?.ok === true && generator.productionTraffic === false && generator.runId === outcome.standRunId
      && generator.bundleSha256 === plan.bundleSha256 && generator.targetClients === plan.stage.clients && generator.seconds === plan.stage.seconds
      && generator.generatorOnly === true && generator.inputMode === plan.stage.inputMode && generator.sdkWebSocket === plan.stage.sdkWebSocket
      && generator.cleanup?.passed === true && generator.attestation?.control === true
      && generator.attestation?.gameApi === true && generator.attestation?.verifiedBeforeGenerators === true && generator.serverReport?.ok === true,
    hostGuardCompleted: guard?.runId === plan.runId && guard.container === plan.containerName && guard.reason === 'container-ended'
      && guard.stopped === false && integer(guard.samples, 1, 2700) && integer(guard.healthChecks, 1, 2700)
      && Array.isArray(guardSamples) && guardSamples.length === guard.samples,
    guardSupervisorCompleted: supervisor?.runId === plan.runId && supervisor.container === plan.containerName && supervisor.passed === true
      && supervisor.reason === 'container-ended' && supervisor.started === true && supervisor.stopConfirmed === true
      && supervisor.guardExitCode === 0 && supervisor.containerExitCode === 0,
    testStopped: outcome.testStopConfirmed === true,
    fixtureRemoved: outcome.remotePrivateFixtureCleanupConfirmed === true && outcome.localPrivateFixtureCleanupConfirmed === true,
    localCleanupConfirmed: outcome.tunnelStopConfirmed === true,
    productionUnchanged: outcome.productionImageAndStartUnchanged === true,
  };
  const ok = Object.values(checks).every(Boolean);
  return { checks, ok, verdict: ok ? 'passed-isolated-limited-stage' : 'failed-or-inconclusive-isolated-stage' };
}

export async function runRemoteWebsocketStage(rawPlan, overrides = {}) {
  const plan = validateRemoteStagePlan(rawPlan), api = overrides.contract ?? await contract();
  const remote = overrides.remote ?? ((action, grace, signal) => remoteAction(plan, action, grace, signal));
  const copy = overrides.copy ?? ((path, secret, signal) => remoteFile(plan, path, secret, signal));
  const production = overrides.production ?? (signal => productionSnapshot(plan, signal));
  const execute = overrides.execute ?? boundedCommand, delay = overrides.delay ?? pause;
  const controller = new AbortController(), abort = () => controller.abort();
  const outcome = { runId: plan.runId, stage: plan.stage, productionTraffic: false, capacity1000Proven: false,
    bundleSha256: plan.bundleSha256, runtimeSha256: plan.runtimeSha256 };
  const reports = {}, filenames = { server: 'server.json', guard: 'host-guard.json', guardSamples: 'host-guard.jsonl', supervisor: 'supervisor.json' };
  await mkdir(plan.outputDir, { recursive: true });
  for (const name of [...Object.values(filenames), 'generators.json', 'outcome.json']) {
    try { await lstat(join(plan.outputDir, name)); fail('stage-output-already-exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const privateDir = await mkdtemp(join(tmpdir(), 'royal-remote-stage-')), manifestPath = join(privateDir, 'stand.json');
  const overall = setTimeout(abort, (plan.stage.seconds + 600) * 1000);
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  let attempted = false, tunnel, tunnelFailure = false;
  try {
    // Cleanup stays necessary when an already prepared stand fails a local preflight.
    attempted = true;
    outcome.productionBefore = await production(controller.signal);
    if (!sameProduction(outcome.productionBefore, plan.production)) fail('stale-production-baseline');
    await (overrides.availablePort ?? availablePort)(plan.localPorts.api);
    await (overrides.availablePort ?? availablePort)(plan.localPorts.control);
    if (plan.startStand) await remote('start', 0, controller.signal);
    const deadline = performance.now() + 90000; let ready, ownedId;
    while (performance.now() < deadline) {
      if (controller.signal.aborted) fail('local-stage-interrupted');
      const status = await remote('status', 0, controller.signal); ownedStatus(plan, status, ownedId); ownedId ??= status.containerId;
      if (status.ready === true) { ready = status; break; } await delay(1500);
    }
    if (!ready) fail('remote-stand-ready-timeout');
    const data = await copy(plan.manifestPath, true, controller.signal);
    if (hash(data) !== ready.manifestSha256) fail('private-manifest-digest-mismatch');
    const manifest = api.parseStandManifest(JSON.parse(data.toString('utf8')));
    if (manifest.runId !== ready.standRunId || manifest.bundleSha256 !== plan.bundleSha256 || manifest.clients !== plan.stage.clients
      || manifest.seconds !== plan.stage.seconds || manifest.serverApiPort !== ready.serverApiPort || manifest.serverControlPort !== ready.serverControlPort
      || manifest.apiEndpoint !== 'http://127.0.0.1:' + plan.localPorts.api || manifest.expiresAt < Date.now() + plan.stage.seconds * 1000) fail('stage-manifest-handoff-mismatch');
    outcome.standRunId = manifest.runId; outcome.containerId = ready.containerId;
    await writeFile(manifestPath, data, { flag: 'wx', mode: 0o600 });
    if ((await stat(manifestPath)).mode & 0o077) fail('private-local-manifest-required');
    const startTunnel = overrides.startTunnel ?? (() => spawn('ssh', [...sshArguments(plan), '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '-N',
      '-L', `127.0.0.1:${plan.localPorts.api}:127.0.0.1:${ready.serverApiPort}`,
      '-L', `127.0.0.1:${plan.localPorts.control}:127.0.0.1:${ready.serverControlPort}`, plan.ssh.host],
      { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH, HOME: homedir(), LANG: 'C.UTF-8' } }));
    tunnel = startTunnel();
    const failedTunnel = () => { tunnelFailure = true; controller.abort(); };
    tunnel.once('error', failedTunnel); tunnel.once('exit', failedTunnel);
    await delay(1000);
    if (tunnelFailure || controller.signal.aborted) fail('ssh-forward-unavailable');
    await (overrides.attestLocal ?? attestLocal)(manifest, plan.localPorts.control, api.verifyStandStatus, controller.signal);
    outcome.attestation = { manifestDigest: true, control: true, gameApi: true, beforeGenerators: true };
    console.error(JSON.stringify({ phase: 'measure', clients: plan.stage.clients, seconds: plan.stage.seconds, generatorOnly: true }));
    const result = await execute(process.execPath, ['--import', 'tsx', 'scripts/load-websocket-generators.ts', '--manifest', manifestPath,
      '--control-port', String(plan.localPorts.control), '--workers', String(plan.stage.workers), '--input-mode', plan.stage.inputMode,
      '--sdk-websocket', plan.stage.sdkWebSocket, '--output', join(plan.outputDir, 'generators.json')],
      { timeoutMs: Math.min((plan.stage.seconds + 600) * 1000, manifest.expiresAt - Date.now() + 15000), signal: controller.signal });
    outcome.generatorExitCode = result.code;
    if (result.code !== 0) fail('generator-stage-failed');
  } catch (error) { outcome.failure = error instanceof StageError ? error.code : 'local-stage-runtime-failure'; outcome.generatorExitCode ??= 1; }
  finally {
    clearTimeout(overall);
    try { outcome.tunnelStopConfirmed = await (overrides.stopTunnel ?? stopTunnel)(tunnel); } catch { outcome.tunnelStopConfirmed = false; }
    if (attempted) {
      try { const reply = await remote('stop', outcome.generatorExitCode === 0 ? 30 : 0);
        outcome.testStopConfirmed = reply.stopConfirmed === true && inactive.includes(reply.state); } catch { outcome.testStopConfirmed = false; }
      for (const [key, source] of Object.entries(plan.artifacts)) {
        try {
          const data = await copy(source, false);
          reports[key] = key === 'guardSamples' ? data.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(data.toString('utf8'));
          await writeFile(join(plan.outputDir, filenames[key]), data, { flag: 'wx' });
        } catch { (outcome.missingArtifacts ??= []).push(key); }
      }
      try { const reply = await remote('cleanup-fixture', 0); outcome.remotePrivateFixtureCleanupConfirmed = reply.privateFixtureRemoved === true; }
      catch { outcome.remotePrivateFixtureCleanupConfirmed = false; }
    }
    try { await rm(privateDir, { recursive: true, force: true }); outcome.localPrivateFixtureCleanupConfirmed = true; }
    catch { outcome.localPrivateFixtureCleanupConfirmed = false; }
    try { reports.generator = JSON.parse(await readFile(join(plan.outputDir, 'generators.json'), 'utf8')); }
    catch { (outcome.missingArtifacts ??= []).push('generator'); }
    try { outcome.productionAfter = await production(); outcome.productionImageAndStartUnchanged =
      sameProduction(outcome.productionAfter, plan.production) && sameProduction(outcome.productionBefore, plan.production); }
    catch { outcome.productionImageAndStartUnchanged = false; }
    Object.assign(outcome, assessRemoteStage(plan, outcome, reports));
    try {
      await (overrides.saveOutcome ?? (value => writeFile(join(plan.outputDir, 'outcome.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })))(outcome);
      console.log(JSON.stringify({ runId: plan.runId, ok: outcome.ok, verdict: outcome.verdict, failure: outcome.failure,
        clients: plan.stage.clients, seconds: plan.stage.seconds, checks: outcome.checks }));
    } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
  }
  return outcome;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--plan') fail('usage-requires-private-plan');
    const path = resolve(process.argv[3]), info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > 128 * 1024) fail('private-600-stage-plan-required');
    const plan = validateRemoteStagePlan(JSON.parse(await readFile(path, 'utf8')));
    const outcome = await runRemoteWebsocketStage(plan); if (!outcome.ok) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ ok: false, error: error instanceof StageError ? error.code : 'local-stage-startup-failed' })); process.exitCode = 1; }
}
