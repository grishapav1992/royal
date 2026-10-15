import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HELPER_SHA256 = 'b1ce729747c84a8b6228f2579175abf1a605c34682eae8244369d1a2107212d8';
export const PREVIOUS_HELPER_SHA256 = 'e27d3a70dfa0405fb99477bfa246aa9287d9b2039f7f5085cccd5dcb7570416c';
export const LEGACY_HELPER_SHA256 = '5421303dac2e8a6f814f3c3f7ffaaa78305a56ef291b719d6e5cf921917a2ceb';
export const MACHINE_SHA256 = '97966a66c8d354a25927d498a4b44f23e9d49c3e7c2941ce0079e1317231421e';
const host = 'root@31.56.189.118', hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = data => createHash('sha256').update(data).digest('hex');
const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
const pause = ms => new Promise(done => setTimeout(done, ms));
const maximumReport = 32 * 1024 ** 2;
const maximumProxyDiagnostics = 8 * 1024 ** 2;
const tlsFailureStages = new Set(['preflight', 'certificate-generation', 'asset-prepare', 'config-validate', 'caddy-start',
  'process-identity', 'tls-attestation', 'ready-verify']);
const tlsFailureCodes = new Set(['stop-requested-before-start', 'ready-stand-required-before-tls', 'fresh-tls-gateway-required',
  'fresh-tls-assets-required', 'exact-running-tls-container-required', 'container-ownership-changed', 'bounded-command-failed',
  'private-tls-asset-required', 'tls-asset-size-changed', 'invalid-generated-tls-assets', 'invalid-tls-upstream-port',
  'invalid-tls-process-identity', 'tls-attestation-deadline', 'invalid-private-tls-attestation', 'tls-peer-certificate-mismatch',
  'tls-attestation-rejected', 'tls-attestation-mismatch', 'tls-attestation-malformed-response', 'tls-certificate-digest-mismatch', 'tls-asset-digest-mismatch',
  'tls-process-changed', 'tls-stand-run-changed', 'tls-gateway-readiness-lost', 'tls-gateway-provenance-mismatch',
  'lifecycle-lock-timeout', 'private-lifecycle-lock-required', 'bounded-command-timeout', 'tls-certificate-rejected', 'tls-failed',
  'permission-denied', 'asset-missing', 'port-in-use', 'tls-listener-unavailable', 'operating-system-failed', 'interrupted', 'dedicated-stand-failed']);
class StageError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new StageError(code); };
const safeError = error => error instanceof StageError ? error.code : 'dedicated-stage-runtime-failure';

export function validateDedicatedStagePlan(value, { platform = process.platform, directInterface } = {}) {
  if (!value || value.protocol !== 1 || !value.remotePlan) fail('invalid-local-stage-plan');
  const remote = value.remotePlan, { budget } = remote;
  if (remote.protocol !== 1 || remote.targetHost !== '31.56.189.118' || !uuid.test(remote.runId ?? '')
    || remote.ownedRoot !== '/opt/royal-load-' + remote.runId
    || remote.containerName !== 'royal-load-' + remote.runId + '-test') fail('unapproved-owned-target');
  const keys = ['protocol', 'targetHost', 'runId', 'ownedRoot', 'containerName', 'imageId', 'metadataSha256',
    'bundleSha256', 'machineIdSha256', 'helperSha256', 'clients', 'seconds', 'gameProcesses', 'budget'];
  const transport = value.transport ?? 'ssh';
  if (!['ssh', 'direct-tls'].includes(transport)) fail('invalid-stage-transport');
  if (transport === 'direct-tls') keys.push('tlsGateway');
  if (Object.keys(remote).length !== keys.length || keys.some(key => !(key in remote))
    || !/^sha256:[a-f0-9]{64}$/.test(remote.imageId ?? '') || !hex.test(remote.metadataSha256 ?? '')
    || !hex.test(remote.bundleSha256 ?? '') || ![HELPER_SHA256, PREVIOUS_HELPER_SHA256, LEGACY_HELPER_SHA256].includes(remote.helperSha256)
    || remote.machineIdSha256 !== MACHINE_SHA256) fail('invalid-pinned-remote-plan');
  if (!integer(remote.gameProcesses, 1, 24) || !integer(remote.clients, 4, Math.min(6000, remote.gameProcesses * 300))
    || !integer(remote.seconds, 1, 1800)) fail('invalid-stage-workload');
  if (!budget || Object.keys(budget).sort().join(',') !== 'cpus,memoryMiB,pidsLimit'
    || typeof budget.cpus !== 'number' || !Number.isFinite(budget.cpus) || budget.cpus < 1 || budget.cpus > 18
    || !integer(budget.memoryMiB, 1024, 40960) || !integer(budget.pidsLimit, 64, 2048)) fail('invalid-container-budget');
  if (!integer(value.workers, 1, Math.min(32, remote.clients)) || !value.localPorts
    || !Array.isArray(value.localPorts.api) || value.localPorts.api.length < value.workers || value.localPorts.api.length > 128
    || !integer(value.localPorts.control, 1024, 65535)
    || value.localPorts.api.some(port => !integer(port, 1024, 65535))
    || new Set([...value.localPorts.api, value.localPorts.control]).size !== value.localPorts.api.length + 1) fail('invalid-local-forward-ports');
  const identityFile = value.identityFile ?? join(homedir(), '.ssh', 'royal_server_ed25519');
  if (identityFile !== join(homedir(), '.ssh', 'royal_server_ed25519')) fail('unapproved-ssh-identity');
  const knownHostsFile = value.knownHostsFile ?? join(project, 'deployment', 'royal-load-known-hosts');
  if (typeof knownHostsFile !== 'string' || resolve(knownHostsFile) !== join(project, 'deployment', 'royal-load-known-hosts')
    || !hex.test(value.knownHostsSha256 ?? '')) fail('pinned-known-hosts-required');
  if (!isAbsolute(value.outputDir ?? '') || resolve(value.outputDir) !== value.outputDir) fail('absolute-output-directory-required');
  if (directInterface !== undefined && (platform !== 'darwin' || directInterface !== 'en0')) fail('unsupported-direct-interface');
  let directTls;
  if (transport === 'direct-tls') {
    const gateway = remote.tlsGateway;
    if (platform !== 'darwin' || ![HELPER_SHA256, PREVIOUS_HELPER_SHA256].includes(remote.helperSha256) || !gateway
      || Object.keys(gateway).sort().join(',') !== 'port,serverName' || gateway.port !== 26443 || gateway.serverName !== 'royal-load.test'
      || value.localPorts.api.join(',') !== '17100,17102,17103,17104' || value.workers > 4) fail('invalid-direct-tls-transport');
    if (!value.directTls || !hex.test(value.directTls.proxySha256 ?? '')
      || Object.keys(value.directTls).some(key => !['proxySha256', 'pythonExecutable'].includes(key))) fail('pinned-local-tls-proxy-required');
    const pythonExecutable = value.directTls.pythonExecutable ?? join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
    if (!isAbsolute(pythonExecutable) || resolve(pythonExecutable) !== pythonExecutable || !/\/python3(?:\.\d+)?$/.test(pythonExecutable)) fail('invalid-proxy-python-executable');
    directTls = { ...value.directTls, pythonExecutable };
  } else if (value.directTls !== undefined) fail('direct-tls-config-needs-explicit-mode');
  return { ...value, identityFile, directInterface, transport, directTls, knownHostsFile: resolve(knownHostsFile) };
}

export function sshArguments(plan) {
  const args = ['-F', '/dev/null', '-i', plan.identityFile, '-p', '22', '-T', '-S', 'none',
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + plan.knownHostsFile,
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1',
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes'];
  if (plan.directInterface) args.push('-o', 'ProxyCommand=/usr/bin/nc -4 -n -b en0 -G10 %h %p');
  return args;
}

/** The group remains owned while a ProxyCommand or generator descendant outlives its leader. */
export async function stopOwnedProcessGroup(child, { kill = process.kill, delay = pause, attempts = 20, gracefulAttempts = attempts } = {}) {
  if (!child || !integer(child.pid, 2, 2 ** 31 - 1)) return false;
  const alive = () => { try { kill(-child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw new StageError('owned-group-check-failed'); } };
  const send = signal => { try { kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') fail('owned-group-stop-failed'); } };
  if (!alive()) return true;
  send('SIGTERM');
  for (let index = 0; index < gracefulAttempts; index++) { if (!alive()) return true; await delay(100); }
  send('SIGKILL');
  for (let index = 0; index < attempts; index++) { if (!alive()) return true; await delay(100); }
  return !alive();
}
export function stopOwnedTlsProxyProcessGroup(child, options = {}) {
  return stopOwnedProcessGroup(child, { ...options, gracefulAttempts: 100 });
}

export function managedCommand(program, args, { timeoutMs, signal, input, maximum = 65536, onProgress, onMessage,
  spawnImpl = spawn, stopGroup = stopOwnedProcessGroup } = {}) {
  if (!integer(timeoutMs, 1, 3500000) || !integer(maximum, 1, maximumReport)) fail('invalid-bounded-command');
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key] !== undefined) env[key] = process.env[key];
  const child = spawnImpl(program, args, { cwd: project, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let failure, bytes = 0, stderrBytes = 0, closed = false, stopping, timer, partial = '', messagePartial = '', lastProgress = 0, lastPhase;
  const chunks = [];
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Long-lived tunnels and monitors may finish before their result is awaited.
  done.catch(() => {});
  const stop = () => stopping ??= Promise.resolve().then(() => stopGroup(child));
  const finish = async (code, exitSignal) => {
    if (closed) return; closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
    try { if (!await stop()) failure ??= 'owned-process-stop-unconfirmed'; }
    catch { failure ??= 'owned-process-stop-unconfirmed'; }
    if (failure) rejectDone(new StageError(failure));
    else resolveDone({ code, signal: exitSignal, stdout: Buffer.concat(chunks), stderrBytes });
  };
  const interrupt = reason => { failure ??= reason; void stop().then(() => finish(null, 'SIGTERM')).catch(() => finish(null, 'SIGKILL')); };
  const abort = () => interrupt('local-stage-interrupted');
  timer = setTimeout(() => interrupt('bounded-command-timeout'), timeoutMs);
  child.stdout.on('data', chunk => {
    bytes += chunk.length; if (bytes > maximum) { interrupt('command-output-limit'); return; } chunks.push(chunk);
    if (!onMessage) return;
    messagePartial += chunk.toString();
    for (const line of messagePartial.split('\n').slice(0, -1)) {
      if (line.length > 16384) { interrupt('command-message-limit'); return; }
      try { onMessage(JSON.parse(line)); } catch { interrupt('command-message-rejected'); return; }
    }
    messagePartial = messagePartial.slice(messagePartial.lastIndexOf('\n') + 1);
    if (messagePartial.length > 16384) interrupt('command-message-limit');
  });
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length; if (stderrBytes > maximum) interrupt('command-error-output-limit');
    if (!onProgress) return;
    partial += chunk.toString();
    for (const line of partial.split('\n').slice(0, -1)) {
      if (line.length > 4096) continue;
      try {
        const raw = JSON.parse(line), safe = {};
        if (['connect', 'measure'].includes(raw.phase)) safe.phase = raw.phase;
        else if (integer(raw.generator, 0, 31)) safe.phase = 'generator-heartbeat';
        else continue;
        for (const key of ['generator', 'connectedClients', 'packetsPerSecond', 'target', 'clients', 'seconds', 'workers'])
          if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0 && raw[key] <= 1000000) safe[key] = raw[key];
        if (Date.now() - lastProgress >= 5000 || safe.phase !== lastPhase) {
          lastProgress = Date.now(); lastPhase = safe.phase; onProgress(safe);
        }
      } catch {}
    }
    partial = partial.slice(partial.lastIndexOf('\n') + 1); if (partial.length > 4096) partial = '';
  });
  child.stdin.on('error', () => {});
  child.once('error', () => { failure ??= 'local-command-spawn-failed'; void finish(null, null); });
  child.once('close', (code, exitSignal) => { void finish(code, exitSignal); });
  signal?.addEventListener('abort', abort, { once: true });
  child.stdin.end(input); if (signal?.aborted) abort();
  return { child, done, stop, get ended() { return closed; } };
}

async function privateFile(path, limit, mode) {
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await descriptor.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit || mode !== undefined && (info.mode & 0o777) !== mode) fail('private-bounded-file-required');
    const data = await descriptor.readFile(); if (data.length > limit) fail('private-file-size-changed'); return data;
  } finally { await descriptor.close(); }
}
async function pins(plan) {
  const key = await lstat(plan.identityFile);
  if (!key.isFile() || key.isSymbolicLink() || key.mode & 0o077) fail('private-ssh-identity-required');
  if (hash(await privateFile(plan.knownHostsFile, 65536)) !== plan.knownHostsSha256) fail('known-hosts-digest-mismatch');
  if (plan.transport === 'direct-tls' && hash(await privateFile(join(project, 'scripts/load-direct-tls-proxy.py'), 1024 ** 2)) !== plan.directTls.proxySha256) fail('tls-proxy-source-digest-mismatch');
}
export function attestationCode(plan, expectedId) {
  const remote = plan.remotePlan;
  return `import hashlib,json,os,stat,subprocess,sys,time\nfrom pathlib import Path\nroot=Path(${JSON.stringify(remote.ownedRoot)})\nexpected=json.loads(${JSON.stringify(JSON.stringify(remote))})\nif root.is_symlink() or root.resolve()!=root or not root.is_dir() or root.stat().st_uid!=0 or stat.S_IMODE(root.stat().st_mode)!=0o700: raise RuntimeError('private-owned-root-required')\ndef private(path,limit=65536,uid=0,mode=0o600):\n fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)\n with os.fdopen(fd,'rb') as f:\n  s=os.fstat(f.fileno())\n  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=uid or s.st_size>limit or (mode is not None and stat.S_IMODE(s.st_mode)!=mode): raise RuntimeError('private-owned-file-required')\n  b=f.read(limit+1)\n  if len(b)>limit: raise RuntimeError('file-size-changed')\n  return b\nremote_plan=root/'plan.json'\nif json.loads(private(remote_plan))!=expected: raise RuntimeError('remote-plan-mismatch')\nhelper=root/'load-dedicated-stand.py'\nif hashlib.sha256(private(helper,1048576,0,None)).hexdigest()!=expected['helperSha256']: raise RuntimeError('helper-digest-mismatch')\nif hashlib.sha256(Path('/etc/machine-id').read_bytes()).hexdigest()!=expected['machineIdSha256']: raise RuntimeError('machine-identity-mismatch')\nrun=root/'run'\nif run.is_symlink() or not run.is_dir() or run.stat().st_uid!=1000 or stat.S_IMODE(run.stat().st_mode)!=0o700: raise RuntimeError('node-owned-run-required')\n` + (expectedId ? `state=json.loads(private(root/'state.json'))\nif state.get('runId')!=expected['runId'] or state.get('containerId')!=${JSON.stringify(expectedId)}: raise RuntimeError('pinned-container-changed')\n` : '');
}
async function remoteAction(plan, action, expectedId, signal) {
  if (!['start', 'status', 'stop', 'tls-start', 'tls-status', 'tls-certificate'].includes(action)
    || action.startsWith('tls-') && plan.transport !== 'direct-tls') fail('invalid-remote-action');
  await pins(plan);
  const seconds = action === 'tls-start' ? 120 : 75;
  const code = attestationCode(plan, expectedId) + `reply=subprocess.run(['python3',str(helper),${JSON.stringify(action)},'--plan',str(remote_plan)],capture_output=True,timeout=${seconds},env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/root'})\nif reply.returncode or len(reply.stdout)>65536: raise RuntimeError('supervisor-action-failed')\nsys.stdout.buffer.write(reply.stdout)\n`;
  const result = await managedCommand('/usr/bin/ssh', [...sshArguments(plan), host, 'python3', '-'], { input: code, timeoutMs: (seconds + 15) * 1000, maximum: 65536, signal }).done;
  if (result.code !== 0) fail('owned-supervisor-command-failed');
  try { return JSON.parse(result.stdout.toString()); } catch { fail('invalid-supervisor-response'); }
}
const files = new Map([['manifest', ['run/stand.json', 1024 ** 2, 1000]], ['server', ['run/server.json', maximumReport, 1000, null]],
  ['state', ['state.json', 65536, 0]], ['guardian', ['guardian.json', 65536, 0]],
  ['resourceSummary', ['resource-monitor.json', 65536, 0]], ['resourceSamples', ['resource-monitor.jsonl', maximumReport, 0]],
  ['tlsGateway', ['tls-gateway.json', 65536, 0]]]);
export function remoteArtifactReadCode(plan, kind, expectedId) {
  if (!files.has(kind)) fail('unapproved-remote-artifact');
  const [path, limit, uid, mode = 0o600] = files.get(kind), read = `private(root/${JSON.stringify(path)},${limit},${uid},${mode === null ? 'None' : mode})`;
  const body = kind === 'tlsGateway'
    ? `value=json.loads(${read})\nallowed=['runId','containerId','imageId','standRunId','phase','certificateSha256','configSha256','caddyPid','caddyStartTicks','failureStage','failureCode']\nsys.stdout.write(json.dumps({key:value[key] for key in allowed if key in value},separators=(',',':')))\n`
    : `sys.stdout.buffer.write(${read})\n`;
  return attestationCode(plan, expectedId) + 'try:\n' + body.trimEnd().split('\n').map(line => ' ' + line).join('\n')
    + '\nexcept FileNotFoundError:\n sys.exit(44)\nexcept PermissionError:\n sys.exit(45)\nexcept RuntimeError:\n sys.exit(46)\nexcept Exception:\n sys.exit(47)\n';
}
export function checkArtifactReadExitCode(code) {
  if (code === 0) return;
  fail({ 255: 'artifact-ssh-transport-failed', 44: 'artifact-remote-not-found', 45: 'artifact-remote-access-denied',
    46: 'artifact-remote-policy-refused', 47: 'artifact-remote-read-failed' }[code] ?? 'artifact-remote-command-failed');
}
async function remoteFile(plan, kind, expectedId, signal) {
  const code = remoteArtifactReadCode(plan, kind, expectedId), [, limit] = files.get(kind);
  await pins(plan);
  const result = await managedCommand('/usr/bin/ssh', [...sshArguments(plan), host, 'python3', '-'], { input: code, timeoutMs: 60000, maximum: limit, signal }).done;
  checkArtifactReadExitCode(result.code); return result.stdout;
}
export function classifyArtifactError(error, stage) {
  const knownCodes = new Map([
    ['ENOENT', ['missing', 'artifact-local-not-found']], ['EACCES', ['rejected', 'artifact-local-access-denied']],
    ['EPERM', ['rejected', 'artifact-local-access-denied']], ['ELOOP', ['rejected', 'artifact-private-file-refused']],
    ['ENOSPC', ['unavailable', 'artifact-local-disk-full']], ['EEXIST', ['rejected', 'artifact-local-output-exists']],
    ['artifact-ssh-transport-failed', ['unavailable', 'artifact-ssh-transport-failed']],
    ['artifact-remote-not-found', ['missing', 'artifact-remote-not-found']],
    ['artifact-remote-access-denied', ['rejected', 'artifact-remote-access-denied']],
    ['artifact-remote-policy-refused', ['rejected', 'artifact-remote-policy-refused']],
    ['artifact-remote-read-failed', ['unavailable', 'artifact-remote-read-failed']],
    ['artifact-remote-command-failed', ['unavailable', 'artifact-remote-command-failed']],
  ]);
  if (knownCodes.has(error?.code)) { const [classification, code] = knownCodes.get(error.code); return { classification, code }; }
  if (error instanceof SyntaxError && stage === 'parse') return { classification: 'rejected', code: 'artifact-invalid-json' };
  const code = safeError(error);
  return { classification: ['parse', 'validate', 'write'].includes(stage) || ['command-output-limit', 'artifact-download-limit',
    'private-bounded-file-required', 'private-file-size-changed'].includes(code) ? 'rejected' : 'unavailable', code };
}
export function resourceMonitorCode(plan, expectedId) {
  const seconds = 900 + plan.remotePlan.seconds + 600;
  return attestationCode(plan, expectedId) + `identifier=${JSON.stringify(expectedId)}\nname=expected['containerName']\nsummary=root/'resource-monitor.json'\nsamples=root/'resource-monitor.jsonl'\nstarted=time.monotonic(); deadline=started+${seconds}; count=0; reason='monitor-timeout'; last=None\ndef inspect():\n fmt='{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"label":{{json (index .Config.Labels "royal.load.run-id")}},"status":{{json .State.Status}},"pid":{{json .State.Pid}},"startedAt":{{json .State.StartedAt}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}}}'\n reply=subprocess.run(['docker','inspect','--format',fmt,identifier],capture_output=True,timeout=5)\n if reply.returncode or len(reply.stdout)>4096: raise RuntimeError('inspect-unavailable')\n value=json.loads(reply.stdout)\n if value['Id']!=identifier or value['Name']!='/'+name or value['Image']!=expected['imageId'] or value['label']!=expected['runId']: raise RuntimeError('ownership-changed')\n return value\ndef numbers(path):\n result={}\n for line in path.read_text().splitlines():\n  fields=line.split()\n  if len(fields)==2 and fields[0] in ['usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec','anon','file','sock','pgfault','pgmajfault','low','high','max','oom','oom_kill']: result[fields[0]]=int(fields[1])\n return result\ntry:\n fd=os.open(samples,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)\n with os.fdopen(fd,'w') as output:\n  while time.monotonic()<deadline:\n   last=inspect(); elapsed=round(time.monotonic()-started,3)\n   cpu=list(map(int,Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))\n   memory=next(int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))\n   sample={'sampledAtMs':int(time.time()*1000),'elapsedSeconds':elapsed,'hostCpuJiffies':cpu,'hostMemAvailableBytes':memory,'container':last}\n   if last['pid']>1 and last['status'] in ['running','restarting','paused']:\n    try:\n     rows=Path('/proc/'+str(last['pid'])+'/cgroup').read_text().splitlines(); unified=next(row[3:] for row in rows if row.startswith('0::'))\n     base=Path('/sys/fs/cgroup'+unified)\n     if not base.resolve().is_relative_to(Path('/sys/fs/cgroup')): raise RuntimeError('cgroup-outside-controller')\n     sample['cgroup']={'cpu':numbers(base/'cpu.stat'),'memoryCurrentBytes':int((base/'memory.current').read_text()),'memoryEvents':numbers(base/'memory.events'),'memoryStat':numbers(base/'memory.stat')}\n    except (FileNotFoundError,ProcessLookupError):\n     last=inspect()\n     if last['status'] not in ['exited','dead']: raise\n     sample['container']=last;sample['sampledAtMs']=int(time.time()*1000);sample['elapsedSeconds']=round(time.monotonic()-started,3)\n   encoded=json.dumps(sample,separators=(',',':'))+'\\n'\n   if len(encoded)>8192 or count>=${seconds + 1}: raise RuntimeError('sample-budget-exceeded')\n   output.write(encoded);output.flush();count+=1\n   if last['status'] in ['created','exited','dead']: reason='container-ended';break\n   time.sleep(1)\nexcept Exception: reason='resource-monitor-failed'\nresult={'runId':expected['runId'],'containerId':identifier,'imageId':expected['imageId'],'reason':reason,'sampleCount':count,'elapsedSeconds':round(time.monotonic()-started,3),'lastState':last['status'] if last else None,'budget':expected['budget'],'definition':'Host CPU jiffies and cgroup cumulative CPU counters; cgroup memory includes all stand services. Samples stop after the owned container ends.'}\nfd=os.open(summary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)\nwith os.fdopen(fd,'w') as output: json.dump(result,output,separators=(',',':'))\nprint(json.dumps({'runId':expected['runId'],'reason':reason,'sampleCount':count},separators=(',',':')))\nif reason!='container-ended': sys.exit(1)\n`;
}
export function checkOwnedStatus(plan, value, expectedId) {
  const remote = plan.remotePlan;
  if (!value || value.runId !== remote.runId || value.targetHost !== remote.targetHost || value.imageId !== remote.imageId
    || value.metadataSha256 !== remote.metadataSha256 || value.bundleSha256 !== remote.bundleSha256
    || ['cpus', 'memoryMiB', 'pidsLimit'].some(key => value.budget?.[key] !== remote.budget[key])
    || value.containerId !== null && !hex.test(value.containerId ?? '')
    || expectedId && value.containerId !== expectedId) fail('owned-stand-status-mismatch');
  if (value.ready && (value.phase !== 'running' || value.containerState !== 'running' || value.guardianActive !== true
    || value.cancelRequested !== false || !hex.test(value.manifestSha256 ?? '') || !uuid.test(value.standRunId ?? '')
    || value.clients !== remote.clients || value.seconds !== remote.seconds || value.gameProcesses !== remote.gameProcesses
    || !integer(value.serverApiPort, 1024, 65535) || !integer(value.serverControlPort, 1024, 65535)
    || value.serverApiPort === value.serverControlPort)) fail('invalid-owned-stand-ready');
  return value.containerId ?? expectedId;
}
export function verifyManifest(plan, bytes, status, parse) {
  if (bytes.length > 1024 ** 2 || hash(bytes) !== status.manifestSha256) fail('manifest-digest-mismatch');
  let manifest; try { manifest = parse(JSON.parse(bytes.toString())); } catch { fail('invalid-private-manifest'); }
  const remote = plan.remotePlan;
  if (manifest.runId !== status.standRunId || manifest.bundleSha256 !== remote.bundleSha256
    || manifest.clients !== remote.clients || manifest.seconds !== remote.seconds || (manifest.gameProcesses ?? 4) !== remote.gameProcesses
    || manifest.apiEndpoint !== 'http://127.0.0.1:17100' || manifest.serverApiPort !== status.serverApiPort
    || manifest.serverControlPort !== status.serverControlPort) fail('manifest-plan-mismatch');
  return manifest;
}
export function checkTlsGatewayStatus(plan, value, containerId, standRunId, pinned) {
  if (plan.transport !== 'direct-tls' || !value || value.runId !== plan.remotePlan.runId || value.containerId !== containerId
    || value.port !== 26443 || value.serverName !== 'royal-load.test' || value.standRunId !== standRunId
    || typeof value.ready !== 'boolean' || typeof value.closed !== 'boolean' || typeof value.assetsRemoved !== 'boolean') fail('tls-gateway-ownership-mismatch');
  checkTlsFailureClassification(value);
  if (value.ready && (value.closed || value.assetsRemoved || !hex.test(value.certificateSha256 ?? '') || !hex.test(value.configSha256 ?? '')
    || !integer(value.caddyPid, 2, 2 ** 31 - 1) || !/^\d+$/.test(value.caddyStartTicks ?? ''))) fail('invalid-tls-gateway-ready');
  if (pinned && (value.certificateSha256 !== pinned.certificateSha256 || value.configSha256 !== pinned.configSha256)) fail('tls-gateway-assets-changed');
  return value;
}
function checkTlsFailureClassification(value) {
  if (value.failureStage !== undefined && !tlsFailureStages.has(value.failureStage)
    || value.failureCode !== undefined && !tlsFailureCodes.has(value.failureCode)) fail('unsafe-tls-failure-classification');
}
function gatewayProvenance(value) {
  return Object.fromEntries(['runId', 'containerId', 'port', 'serverName', 'ready', 'closed', 'assetsRemoved', 'standRunId',
    'certificateSha256', 'configSha256', 'caddyPid', 'caddyStartTicks', 'failureStage', 'failureCode']
    .filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
export function verifyPublicCertificate(plan, value, containerId, gateway) {
  if (!value || value.runId !== plan.remotePlan.runId || value.containerId !== containerId
    || value.certificateSha256 !== gateway.certificateSha256 || typeof value.certificatePEM !== 'string'
    || !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/.test(value.certificatePEM)) fail('invalid-public-tls-certificate');
  const bytes = Buffer.from(value.certificatePEM);
  if (bytes.length > 16384 || hash(bytes) !== gateway.certificateSha256) fail('public-tls-certificate-digest-mismatch');
  return bytes;
}
export function directTlsProxyConfig(plan, certificatePath, gateway) {
  return { runId: plan.remotePlan.runId, clientLimit: plan.remotePlan.clients, listenHost: '127.0.0.1',
    listenPorts: [...plan.localPorts.api], remoteHost: '31.56.189.118', remotePort: 26443, interface: 'en0',
    certSha256: gateway.certificateSha256, publicCertPath: certificatePath, serverName: 'royal-load.test',
    sessionSeconds: 900 + plan.remotePlan.seconds + 600 };
}
export function checkTlsProxyReady(config, ready, pid) {
  if (!ready || ready.kind !== 'ready' || ready.runId !== config.runId || ready.pid !== pid
    || ready.listenHost !== config.listenHost || ready.listenPorts?.join(',') !== config.listenPorts.join(',')
    || ready.remoteHost !== config.remoteHost || ready.remotePort !== config.remotePort || ready.serverName !== config.serverName
    || ready.interface !== config.interface || ready.certSha256 !== config.certSha256 || ready.clientLimit !== config.clientLimit
    || ready.socketLimit !== config.clientLimit + 64 || ready.requiredFds !== 2 * (config.clientLimit + 64) + 128
    || !integer(ready.fdSoftLimit, ready.requiredFds, Number.MAX_SAFE_INTEGER) || ready.sessionSeconds !== config.sessionSeconds) fail('tls-proxy-ready-mismatch');
  return { kind: ready.kind, runId: ready.runId, pid: ready.pid, listenHost: ready.listenHost, listenPorts: [...ready.listenPorts],
    remoteHost: ready.remoteHost, remotePort: ready.remotePort, serverName: ready.serverName, interface: ready.interface,
    certSha256: ready.certSha256, clientLimit: ready.clientLimit, socketLimit: ready.socketLimit, requiredFds: ready.requiredFds,
    fdSoftLimit: ready.fdSoftLimit, sessionSeconds: ready.sessionSeconds };
}
export function checkTlsProxyFinished(plan, value) {
  const counters = ['acceptedConnections', 'rejectedConnections', 'activeConnections', 'peakConnections', 'upstreamSocketsCreated',
    'tlsConnections', 'completedConnections', 'bytesToUpstream', 'bytesToLocal', 'errorCount'];
  if (!value || value.kind !== 'finished' || value.runId !== plan.remotePlan.runId || value.reason !== 'signal'
    || value.cleanup !== true || value.independentUpstreamPerLocalTcp !== true
    || counters.some(key => !integer(value[key], 0, Number.MAX_SAFE_INTEGER))
    || value.errorCount !== 0 || value.activeConnections !== 0 || value.rejectedConnections !== 0
    || value.acceptedConnections < plan.remotePlan.clients || value.peakConnections > plan.remotePlan.clients + 64
    || value.tlsConnections !== value.upstreamSocketsCreated || value.tlsConnections !== value.acceptedConnections
    || value.completedConnections > value.tlsConnections || value.bytesToUpstream === 0 || value.bytesToLocal === 0
    || !value.errors || Array.isArray(value.errors) || typeof value.errors !== 'object'
    || Object.values(value.errors).some(count => !integer(count, 0, Number.MAX_SAFE_INTEGER) || count !== 0)) fail('tls-proxy-final-mismatch');
  const resources = value.resources, lag = resources?.eventLoopLag;
  if (['durationSeconds'].some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] <= 0)
    || value.durationSeconds > 900 + plan.remotePlan.seconds + 600
    || !resources || ['cpuUserSeconds', 'cpuSystemSeconds', 'maxRssMiB'].some(key => typeof resources[key] !== 'number'
      || !Number.isFinite(resources[key]) || resources[key] < 0)
    || !lag || lag.periodMs !== 100 || !integer(lag.count, 0, Number.MAX_SAFE_INTEGER)
    || !integer(lag.sampleCount, 0, Math.min(8192, lag.count)) || !['complete', 'bounded-reservoir'].includes(lag.sampling)
    || ['p99Ms', 'maxMs'].some(key => typeof lag[key] !== 'number' || !Number.isFinite(lag[key]) || lag[key] < 0)
    || lag.p99Ms > lag.maxMs) fail('tls-proxy-resource-mismatch');
  return { kind: value.kind, runId: value.runId, reason: value.reason, cleanup: value.cleanup,
    independentUpstreamPerLocalTcp: value.independentUpstreamPerLocalTcp, durationSeconds: value.durationSeconds,
    ...Object.fromEntries(counters.map(key => [key, value[key]])),
    resources: { cpuUserSeconds: resources.cpuUserSeconds, cpuSystemSeconds: resources.cpuSystemSeconds, maxRssMiB: resources.maxRssMiB,
      eventLoopLag: Object.fromEntries(['periodMs', 'count', 'sampleCount', 'sampling', 'p99Ms', 'maxMs'].map(key => [key, lag[key]])) } };
}
function launchTlsProxy(plan, configPath, outputPath, diagnosticsPath, config, run, signal) {
  let accept, reject;
  const ready = new Promise((resolve, decline) => { accept = resolve; reject = decline; }); ready.catch(() => {});
  const handle = run(plan.directTls.pythonExecutable, ['-B', join(project, 'scripts/load-direct-tls-proxy.py'), '--config', configPath, '--output', outputPath,
    '--diagnostics-output', diagnosticsPath],
    { timeoutMs: config.sessionSeconds * 1000, maximum: 65536, signal, stopGroup: stopOwnedTlsProxyProcessGroup,
      onMessage: value => { if (value.kind === 'ready') accept(value); } });
  handle.done.then(() => reject(new StageError('tls-proxy-ended-before-ready')), () => reject(new StageError('tls-proxy-failed-before-ready')));
  return { handle, ready };
}
export function localMeasurementWindow(plan, phaseObservedAtMs, generatorCompletedAtMs, generator) {
  const phase = integer(phaseObservedAtMs, 1, Number.MAX_SAFE_INTEGER) ? phaseObservedAtMs : null;
  const completed = integer(generatorCompletedAtMs, 1, Number.MAX_SAFE_INTEGER) ? generatorCompletedAtMs : null;
  const result = { measurePhaseObservedAtMs: phase, generatorCompletedAtMs: completed,
    nominalSendingSeconds: plan.remotePlan.seconds, maximumDrainSeconds: 2,
    nominalSendEndAtMs: phase === null ? null : phase + plan.remotePlan.seconds * 1000,
    reportedWorkerSendSeconds: null, reportedWorkerObservationSeconds: null, reportedWorkerDrainSeconds: null,
    estimatedSendEndAtMs: null, estimatedObservationEndAtMs: null,
    definition: 'The generator emits its first measure stderr phase before worker commands; its receipt here is an approximate local alignment anchor that may follow those commands because of IPC delay. Worker durations distinguish sending from up to 2s ACK drain; estimated ends add their longest reported durations to that anchor. Generator completion additionally includes server report transfer and child cleanup. This is not a cross-host clock or latency measurement.' };
  if (!Array.isArray(generator?.results) || generator.results.length !== plan.workers) return result;
  const numbers = ['durationSeconds', 'observationSeconds', 'drainSeconds'];
  if (generator.results.some(value => numbers.some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)
    || value.durationSeconds > plan.remotePlan.seconds + 15 || value.observationSeconds < value.durationSeconds
    || value.observationSeconds > plan.remotePlan.seconds + 30 || value.drainSeconds > 10)) return result;
  result.reportedWorkerSendSeconds = generator.results.map(value => value.durationSeconds);
  result.reportedWorkerObservationSeconds = generator.results.map(value => value.observationSeconds);
  result.reportedWorkerDrainSeconds = generator.results.map(value => value.drainSeconds);
  if (phase !== null) {
    result.estimatedSendEndAtMs = phase + Math.max(...result.reportedWorkerSendSeconds) * 1000;
    result.estimatedObservationEndAtMs = phase + Math.max(...result.reportedWorkerObservationSeconds) * 1000;
  }
  return result;
}
export function validateTlsProxyDiagnostics(plan, data, finished, window) {
  const rowKeys = ['kind', 'runId', 'sampledAtMs', 'intervalStartedAtMs', 'monotonicElapsedMs', 'intervalMs',
    'cpuUserSeconds', 'cpuSystemSeconds', 'cpuOneCorePercent', 'maxRssMiB', 'counters', 'eventLoopLag'];
  const counterKeys = ['acceptedConnections', 'rejectedConnections', 'activeConnections', 'peakConnections', 'upstreamSocketsCreated',
    'tlsConnections', 'completedConnections', 'bytesToUpstream', 'bytesToLocal', 'errorCount'];
  const lagKeys = ['count', 'sampleCount', 'sampling', 'p99Ms', 'maxMs'];
  const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > maximumProxyDiagnostics || !data.toString().endsWith('\n')) fail('invalid-tls-proxy-diagnostics-size');
  const lines = data.toString().split('\n'); lines.pop();
  if (lines.length < 2 || lines.length > 3302 || lines.some(line => Buffer.byteLength(line) > 8192)) fail('invalid-tls-proxy-diagnostics-count');
  let rows; try { rows = lines.map(line => JSON.parse(line)); } catch { fail('invalid-tls-proxy-diagnostics-json'); }
  let previous, maxGapMs = 0;
  for (const [index, row] of rows.entries()) {
    if (!exactKeys(row, rowKeys) || row.kind !== (index === 0 ? 'initial' : index === rows.length - 1 ? 'final' : 'sample')
      || row.runId !== plan.remotePlan.runId || !integer(row.sampledAtMs, 1, Number.MAX_SAFE_INTEGER)
      || !integer(row.intervalStartedAtMs, 1, row.sampledAtMs)
      || ['monotonicElapsedMs', 'intervalMs', 'cpuUserSeconds', 'cpuSystemSeconds', 'cpuOneCorePercent', 'maxRssMiB']
        .some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0)
      || !exactKeys(row.counters, counterKeys) || counterKeys.some(key => !integer(row.counters[key], 0, Number.MAX_SAFE_INTEGER))
      || !exactKeys(row.eventLoopLag, lagKeys) || !integer(row.eventLoopLag.count, 0, Number.MAX_SAFE_INTEGER)
      || !integer(row.eventLoopLag.sampleCount, 0, Math.min(128, row.eventLoopLag.count))
      || !['complete', 'bounded-reservoir'].includes(row.eventLoopLag.sampling)
      || (row.eventLoopLag.sampling === 'complete') !== (row.eventLoopLag.sampleCount === row.eventLoopLag.count)
      || ['p99Ms', 'maxMs'].some(key => typeof row.eventLoopLag[key] !== 'number' || !Number.isFinite(row.eventLoopLag[key]) || row.eventLoopLag[key] < 0)
      || row.eventLoopLag.p99Ms > row.eventLoopLag.maxMs
      || row.eventLoopLag.count === 0 && (row.eventLoopLag.p99Ms !== 0 || row.eventLoopLag.maxMs !== 0)) fail('invalid-tls-proxy-diagnostics-row');
    const counters = row.counters;
    if (counters.activeConnections > counters.peakConnections || counters.peakConnections > plan.remotePlan.clients + 64
      || counters.tlsConnections > counters.upstreamSocketsCreated || counters.upstreamSocketsCreated > counters.acceptedConnections
      || counters.completedConnections > counters.tlsConnections || counters.rejectedConnections > counters.acceptedConnections) fail('invalid-tls-proxy-diagnostics-counters');
    if (previous) {
      const gap = row.sampledAtMs - previous.sampledAtMs;
      if (gap < 0 || row.kind !== 'final' && gap === 0 || row.monotonicElapsedMs < previous.monotonicElapsedMs
        || row.kind !== 'final' && row.monotonicElapsedMs === previous.monotonicElapsedMs
        || row.intervalStartedAtMs !== previous.sampledAtMs || row.kind !== 'final' && row.intervalMs === 0
        || counterKeys.filter(key => key !== 'activeConnections').some(key => counters[key] < previous.counters[key])) fail('invalid-tls-proxy-diagnostics-timeline');
      maxGapMs = Math.max(maxGapMs, gap);
    } else if (row.intervalStartedAtMs !== row.sampledAtMs || row.intervalMs !== 0 || row.cpuUserSeconds !== 0
      || row.cpuSystemSeconds !== 0 || row.cpuOneCorePercent !== 0) fail('invalid-tls-proxy-diagnostics-initial');
    previous = row;
  }
  const diagnostics = finished?.diagnostics, first = rows[0], last = rows.at(-1);
  if (!finished || finished.kind !== 'finished' || finished.runId !== plan.remotePlan.runId || !diagnostics
    || !exactKeys(diagnostics, ['periodMs', 'startedAtMs', 'endedAtMs', 'rowCount', 'rowsWritten', 'bytesWritten', 'maxCpuOneCorePercent', 'maxIntervalLagMs', 'outputWritten'])
    || diagnostics.periodMs !== 1000 || diagnostics.rowCount !== rows.length || diagnostics.rowsWritten !== rows.length
    || diagnostics.bytesWritten !== data.length || diagnostics.outputWritten !== true
    || diagnostics.startedAtMs !== first.sampledAtMs || diagnostics.endedAtMs !== last.sampledAtMs
    || diagnostics.maxCpuOneCorePercent !== Math.max(...rows.map(row => row.cpuOneCorePercent))
    || diagnostics.maxIntervalLagMs !== Math.max(...rows.map(row => row.eventLoopLag.maxMs))
    || counterKeys.some(key => finished[key] !== last.counters[key])) fail('tls-proxy-diagnostics-summary-mismatch');
  const stages = new Set(['accept', 'interface-bind', 'tcp-connect', 'tls-handshake', 'to-upstream-read', 'to-upstream-write', 'to-upstream-drain',
    'to-local-read', 'to-local-write', 'to-local-drain', 'cleanup', 'asyncio', 'unknown']);
  const types = new Set(['limit', 'tls-certificate', 'tls', 'connection-reset', 'broken-pipe', 'connection-aborted', 'timeout', 'refused', 'os-error', 'other']);
  if (!finished.errorDetails || Array.isArray(finished.errorDetails) || typeof finished.errorDetails !== 'object'
    || Object.entries(finished.errorDetails).some(([key, count]) => {
      const parts = key.split('/'); return parts.length !== 2 || !stages.has(parts[0]) || !types.has(parts[1]) || !integer(count, 1, Number.MAX_SAFE_INTEGER);
    }) || Object.values(finished.errorDetails).reduce((sum, count) => sum + count, 0) !== last.counters.errorCount) fail('unsafe-tls-proxy-error-details');
  return { rowCount: rows.length, sha256: hash(data), firstSampleAtMs: first.sampledAtMs, lastSampleAtMs: last.sampledAtMs, maximumGapMs: maxGapMs,
    localSendingPeriodBracketed: integer(window?.measurePhaseObservedAtMs, 1, Number.MAX_SAFE_INTEGER)
      && Number.isFinite(window?.estimatedSendEndAtMs) && first.sampledAtMs <= window.measurePhaseObservedAtMs && last.sampledAtMs >= window.estimatedSendEndAtMs,
    localObservationPeriodBracketed: integer(window?.measurePhaseObservedAtMs, 1, Number.MAX_SAFE_INTEGER)
      && Number.isFinite(window?.estimatedObservationEndAtMs) && first.sampledAtMs <= window.measurePhaseObservedAtMs && last.sampledAtMs >= window.estimatedObservationEndAtMs,
    maximumSampledCpuOneCorePercent: Math.max(...rows.map(row => row.cpuOneCorePercent)),
    maximumSampledIntervalLagMs: Math.max(...rows.map(row => row.eventLoopLag.maxMs)), counters: { ...last.counters },
    errorDetails: { ...finished.errorDetails },
    definition: 'Bounded own-proxy samples include connection setup, sending, ACK drain and cleanup. Local estimated worker windows align sending and drain approximately; CPU values cover complete sampled intervals. Sample peaks do not prove continuous peaks or remote server timing.' };
}
async function bounded(work, ms, code) {
  let timeout;
  try { return await Promise.race([work, new Promise((_, reject) => { timeout = setTimeout(() => reject(new StageError(code)), ms); })]); }
  finally { clearTimeout(timeout); }
}
export async function privateTemporaryDirectory(base = tmpdir()) {
  return realpath(await mkdtemp(join(base, 'royal-dedicated-')));
}
async function availablePort(port) {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', () => reject(new StageError('local-forward-port-unavailable'))); server.listen(port, '127.0.0.1', done); });
  await new Promise(done => server.close(done));
}
async function contract() {
  const { tsImport } = await import('tsx/esm/api');
  return tsImport('./load-stand-contract.ts', import.meta.url);
}
async function attest(plan, manifest, api, signal) {
  const targets = [['http://127.0.0.1:' + plan.localPorts.control, '/status'],
    ...plan.localPorts.api.map(port => ['http://127.0.0.1:' + port, '/__load-stand/status'])];
  for (const [origin, path] of targets) {
    const response = await fetch(origin + path, { redirect: 'error', headers: { Authorization: 'Bearer ' + manifest.secret },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok || !response.body) fail('loopback-attestation-rejected');
    let bytes = 0; const chunks = [];
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 65536) fail('attestation-response-too-large'); chunks.push(chunk); }
    api.verifyStandStatus(JSON.parse(Buffer.concat(chunks).toString()), manifest);
  }
}
export function resourceCoverage(plan, server, summary, rows, containerId) {
  const result = { fullIntervalObserved: false, maximumGapMs: null, requiredStartMs: null, requiredEndMs: null,
    firstLiveCounterMs: null, lastLiveCounterMs: null, unobservedCounterTailMs: null, fullCounterRangeBracketed: false,
    definition: 'Same-server wall timestamps only. Full interval observation includes the terminal state sample; live cumulative CPU counter endpoints are reported separately. Samples do not establish continuous CPU or memory peaks. An omitted metric epoch start is derived conservatively from last sampledAt minus whole-epoch observedSeconds.' };
  if (!server || !summary || !Array.isArray(rows) || rows.length < 3 || rows.length > 3301 || rows.length !== summary.sampleCount
    || summary.reason !== 'container-ended' || summary.runId !== plan.remotePlan.runId || summary.containerId !== containerId
    || summary.imageId !== plan.remotePlan.imageId) return result;
  const processes = Object.values(server.servers ?? {});
  if (processes.length !== plan.remotePlan.gameProcesses || !server.orchestrator || !server.proxyResources) return result;
  const ranges = [];
  for (const metrics of [...processes, server.orchestrator, server.proxyResources]) {
    const intervals = metrics?.intervals;
    if (!Array.isArray(intervals) || !intervals.length || !integer(metrics.samples, intervals.length, 10000)
      || typeof metrics.observedSeconds !== 'number' || !Number.isFinite(metrics.observedSeconds) || metrics.observedSeconds <= 0) return result;
    let first = Infinity, last = 0;
    for (const interval of intervals) {
      const start = interval.intervalStartedAt ?? interval.sampledAt - interval.intervalMs;
      if (!Number.isFinite(start) || !integer(interval.sampledAt, 1, Number.MAX_SAFE_INTEGER)
        || start >= interval.sampledAt || last && interval.sampledAt <= last) return result;
      first = Math.min(first, start); last = interval.sampledAt;
    }
    if (metrics.samples > intervals.length) first = Math.min(first, last - metrics.observedSeconds * 1000 - 10);
    ranges.push([first, last]);
  }
  result.requiredStartMs = Math.min(...ranges.map(range => range[0]));
  result.requiredEndMs = Math.max(...ranges.map(range => range[1]));
  let previous, runningCount = 0, maxGap = 0;
  for (const row of rows) {
    if (!integer(row.sampledAtMs, 1, Number.MAX_SAFE_INTEGER) || typeof row.elapsedSeconds !== 'number'
      || !Number.isFinite(row.elapsedSeconds) || row.elapsedSeconds < 0 || !integer(row.hostMemAvailableBytes, 0, Number.MAX_SAFE_INTEGER)
      || !Array.isArray(row.hostCpuJiffies) || row.hostCpuJiffies.length !== 8
      || row.hostCpuJiffies.some(value => !integer(value, 0, Number.MAX_SAFE_INTEGER))
      || row.container?.Id !== containerId || row.container.Image !== plan.remotePlan.imageId
      || row.container.label !== plan.remotePlan.runId) return result;
    if (previous) {
      const gap = row.sampledAtMs - previous.sampledAtMs;
      if (gap <= 0 || row.elapsedSeconds <= previous.elapsedSeconds) return result;
      maxGap = Math.max(maxGap, gap);
      if (row.hostCpuJiffies.reduce((a, b) => a + b, 0) < previous.hostCpuJiffies.reduce((a, b) => a + b, 0)) return result;
    }
    if (row.container.status === 'running') {
      const cpu = row.cgroup?.cpu, events = row.cgroup?.memoryEvents;
      if (!cpu || ['usage_usec', 'user_usec', 'system_usec', 'nr_periods', 'nr_throttled', 'throttled_usec']
        .some(key => !integer(cpu[key], 0, Number.MAX_SAFE_INTEGER))
        || !integer(row.cgroup.memoryCurrentBytes, 1, Number.MAX_SAFE_INTEGER) || !events || !integer(events.oom_kill, 0, Number.MAX_SAFE_INTEGER)
        || !row.cgroup.memoryStat || !integer(row.cgroup.memoryStat.anon, 0, Number.MAX_SAFE_INTEGER)
        || previous?.cgroup?.cpu && cpu.usage_usec < previous.cgroup.cpu.usage_usec) return result;
      runningCount++;
      result.firstLiveCounterMs ??= row.sampledAtMs; result.lastLiveCounterMs = row.sampledAtMs;
    } else if (row !== rows.at(-1) || !['exited', 'dead'].includes(row.container.status)) return result;
    previous = row;
  }
  result.maximumGapMs = maxGap;
  result.fullIntervalObserved = runningCount >= 2 && rows[0].container.status === 'running'
    && ['exited', 'dead'].includes(rows.at(-1).container.status) && maxGap <= 3000
    && rows[0].sampledAtMs <= result.requiredStartMs && rows.at(-1).sampledAtMs >= result.requiredEndMs;
  result.unobservedCounterTailMs = result.lastLiveCounterMs === null ? null : Math.max(0, result.requiredEndMs - result.lastLiveCounterMs);
  result.fullCounterRangeBracketed = result.fullIntervalObserved && result.firstLiveCounterMs <= result.requiredStartMs
    && result.lastLiveCounterMs >= result.requiredEndMs;
  return result;
}
export function assessDedicatedStage(plan, outcome, reports) {
  const { remotePlan: remote } = plan, { server, generator, state, resourceSummary, guardian } = reports;
  const checks = {
    orchestrationCompleted: !outcome.failure && outcome.generatorExitCode === 0,
    attestedBeforeGenerators: outcome.attestedBeforeGenerators === true,
    serverChecksPassed: server?.ok === true && server.productionTraffic === false && server.bundle?.sha256 === remote.bundleSha256
      && server.targetClients === remote.clients && server.measurementSeconds === remote.seconds && server.gameProcesses === remote.gameProcesses
      && server.stand?.runId === outcome.standRunId && server.cleanup?.passed === true && Object.keys(server.checks ?? {}).length > 0
      && Object.values(server.checks ?? {}).every(value => value === true),
    generatorChecksPassed: generator?.ok === true && generator.productionTraffic === false && generator.generatorOnly === true
      && generator.runId === outcome.standRunId && generator.bundleSha256 === remote.bundleSha256 && generator.targetClients === remote.clients
      && generator.seconds === remote.seconds && generator.inputMode === 'browser-window' && generator.sdkWebSocket === 'ws'
      && generator.results?.length === plan.workers && generator.cleanup?.passed === true
      && generator.attestation?.control === true && generator.attestation?.gameApi === true && generator.attestation?.verifiedBeforeGenerators === true,
    supervisorCompleted: state?.runId === remote.runId && state.containerId === outcome.containerId && state.phase === 'ended'
      && state.passed === true && state.reason === 'container-ended' && state.stopConfirmed === true && state.privateFixtureGone === true,
    guardianCompleted: guardian?.runId === remote.runId && guardian.phase === 'ended' && guardian.reason === 'supervisor-completed'
      && guardian.stopConfirmed === true && guardian.privateFixtureGone === true,
    resourceCoverage: resourceSummary?.runId === remote.runId && resourceSummary.containerId === outcome.containerId
      && resourceSummary.imageId === remote.imageId && resourceSummary.reason === 'container-ended'
      && integer(resourceSummary.sampleCount, 1, 3301) && outcome.resourceMonitorExitCode === 0
      && outcome.resourceCoverage?.fullIntervalObserved === true,
    remoteStopped: outcome.stopConfirmed === true && outcome.remotePrivateFixtureGone === true,
    localCleanup: outcome.ownedGroupsStopped === true && outcome.localPrivateFixtureGone === true,
    artifactsComplete: !(outcome.missingArtifacts?.length) && !(outcome.rejectedArtifacts?.length),
    transportProvenance: plan.transport !== 'direct-tls' || outcome.tlsGatewayReadyValidated === true
      && outcome.tlsProxyReadyValidated === true && outcome.tlsGatewayFinal?.closed === true
      && outcome.tlsGatewayFinal?.assetsRemoved === true && outcome.tlsProxyExitCode === 0 && outcome.tlsProxyFinalValidated === true
      && outcome.tlsProxyDiagnostics?.localObservationPeriodBracketed === true,
  };
  return { checks, ok: Object.values(checks).every(Boolean), verdict: Object.values(checks).every(Boolean)
    ? 'passed-dedicated-limited-stage' : 'failed-or-inconclusive-dedicated-stage' };
}

export async function runDedicatedWebsocketStage(rawPlan, overrides = {}) {
  const plan = validateDedicatedStagePlan(rawPlan, overrides), api = overrides.contract ?? await contract();
  const delay = overrides.delay ?? pause, now = overrides.now ?? Date.now;
  const remote = overrides.remote ?? ((action, id, signal) => remoteAction(plan, action, id, signal));
  const copy = overrides.copy ?? ((kind, id, signal) => remoteFile(plan, kind, id, signal));
  const run = overrides.command ?? managedCommand, checkPins = overrides.pins ?? (() => pins(plan));
  const controller = new AbortController(), abort = () => controller.abort(), handles = [], reports = {};
  const outcome = { runId: plan.remotePlan.runId, targetHost: plan.remotePlan.targetHost, productionTraffic: false,
    clients: plan.remotePlan.clients, seconds: plan.remotePlan.seconds, gameProcesses: plan.remotePlan.gameProcesses,
    workers: plan.workers, transport: plan.transport, transports: plan.transport === 'ssh' ? plan.localPorts.api.length : null,
    apiAliases: plan.localPorts.api.length, sshGameCarriers: plan.transport === 'ssh' ? plan.localPorts.api.length : 0,
    sshControlCarriers: 1, budget: plan.remotePlan.budget, directInterface: plan.directInterface ?? null,
    capacityDefinition: 'A bounded isolated test with container limits; tunnel and generator resources affect the result.',
    missingArtifacts: [], rejectedArtifacts: [], artifactErrors: [], artifactRetries: [] };
  await mkdir(plan.outputDir, { mode: 0o700 });
  plan.outputDir = await realpath(plan.outputDir);
  let temporary, monitor, expectedId, cleaning = false, cleanupAuthorized = false, gateway, tlsProxy, tlsProxyOutput, tlsProxyDiagnosticsPath;
  let measurePhaseObservedAtMs = null, generatorCompletedAtMs = null;
  const wallNow = overrides.wallNow ?? Date.now;
  const progress = value => {
    if (value.phase === 'measure' && measurePhaseObservedAtMs === null) measurePhaseObservedAtMs = wallNow();
    overrides.progress?.(value);
  };
  let artifactRetryBudget = 2;
  const recordArtifactError = (artifact, stage, error) => {
    const result = classifyArtifactError(error, stage);
    outcome.artifactErrors.push({ artifact, stage, ...result });
    (result.classification === 'rejected' ? outcome.rejectedArtifacts : outcome.missingArtifacts).push(artifact);
  };
  const copyArtifact = async artifact => {
    try { return await copy(artifact, expectedId); }
    catch (error) {
      if (error?.code !== 'artifact-ssh-transport-failed' || artifactRetryBudget === 0) throw error;
      artifactRetryBudget--;
      const retry = { artifact, code: 'artifact-ssh-transport-failed', readRecovered: false }; outcome.artifactRetries.push(retry);
      await delay(250);
      const data = await copy(artifact, expectedId); retry.readRecovered = true; return data;
    }
  };
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  const timer = setTimeout(abort, (900 + plan.remotePlan.seconds + 600) * 1000);
  const wait = async (work, duration, code) => {
    const deadline = now() + duration;
    while (now() < deadline && !controller.signal.aborted) { const result = await work(); if (result) return result; await delay(1000); }
    fail(controller.signal.aborted ? 'local-stage-interrupted' : code);
  };
  try {
    await checkPins();
    for (const port of [...plan.localPorts.api, plan.localPorts.control]) await (overrides.availablePort ?? availablePort)(port);
    const initial = await remote('status', undefined, controller.signal); checkOwnedStatus(plan, initial);
    if (initial.phase !== 'not-started' || initial.containerId !== null || initial.ready || initial.cancelRequested) fail('fresh-unstarted-run-required');
    // A lost start reply may still have created our new run, so cleanup begins before dispatch.
    cleanupAuthorized = true;
    await remote('start', undefined, controller.signal);
    const ready = await wait(async () => {
      const status = await remote('status', expectedId, controller.signal);
      expectedId = checkOwnedStatus(plan, status, expectedId); outcome.containerId = expectedId;
      if (['ended', 'failed'].includes(status.phase) || status.cancelRequested) fail('stand-ended-before-ready');
      return status.ready ? status : false;
    }, 900000, 'stand-readiness-timeout');
    await checkPins();
    monitor = overrides.monitor ? await overrides.monitor(expectedId, controller.signal)
      : run('/usr/bin/ssh', [...sshArguments(plan), host, 'python3', '-'], { input: resourceMonitorCode(plan, expectedId),
        timeoutMs: (900 + plan.remotePlan.seconds + 600) * 1000, signal: controller.signal });
    handles.push(monitor);
    monitor.done.then(result => { if (result.code !== 0 && !cleaning) controller.abort(); }, () => { if (!cleaning) controller.abort(); });
    const data = await copy('manifest', expectedId, controller.signal), manifest = verifyManifest(plan, data, ready, api.parseStandManifest);
    outcome.standRunId = manifest.runId;
    temporary = await privateTemporaryDirectory();
    const manifestPath = join(temporary, 'stand.json');
    await writeFile(manifestPath, data, { mode: 0o600, flag: 'wx' });
    if (plan.transport === 'direct-tls') {
      await remote('tls-start', expectedId, controller.signal);
      gateway = await wait(async () => {
        const value = checkTlsGatewayStatus(plan, await remote('tls-status', expectedId, controller.signal), expectedId, manifest.runId);
        return value.ready ? value : false;
      }, 60000, 'tls-gateway-readiness-timeout');
      outcome.tlsGatewayReadyValidated = true; outcome.tlsGateway = gatewayProvenance(gateway);
      const certificate = verifyPublicCertificate(plan, await remote('tls-certificate', expectedId, controller.signal), expectedId, gateway);
      const certificatePath = join(temporary, 'public-tls-certificate.pem'), configPath = join(temporary, 'direct-tls-proxy.json');
      await writeFile(certificatePath, certificate, { mode: 0o600, flag: 'wx' });
      const config = directTlsProxyConfig(plan, certificatePath, gateway);
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
      tlsProxyOutput = join(plan.outputDir, 'direct-tls-proxy.json');
      tlsProxyDiagnosticsPath = join(plan.outputDir, 'direct-tls-proxy-resources.jsonl');
      const launched = overrides.tlsProxy ? await overrides.tlsProxy(configPath, tlsProxyOutput, config, controller.signal, tlsProxyDiagnosticsPath)
        : launchTlsProxy(plan, configPath, tlsProxyOutput, tlsProxyDiagnosticsPath, config, run, controller.signal);
      tlsProxy = launched.handle; handles.push(tlsProxy);
      tlsProxy.done.then(() => { if (!cleaning) controller.abort(); }, () => { if (!cleaning) controller.abort(); });
      outcome.tlsProxyReady = checkTlsProxyReady(config, await bounded(launched.ready, 30000, 'tls-proxy-readiness-timeout'), tlsProxy.child.pid);
      outcome.tlsProxyReadyValidated = true;
      await checkPins();
      const forward = ['-L', '127.0.0.1:' + plan.localPorts.control + ':127.0.0.1:' + ready.serverControlPort];
      const args = [...sshArguments(plan), '-N', ...forward, host];
      const tunnel = overrides.tunnel ? await overrides.tunnel(0, args, controller.signal)
        : run('/usr/bin/ssh', args, { timeoutMs: (900 + plan.remotePlan.seconds + 600) * 1000, signal: controller.signal });
      handles.push(tunnel);
      tunnel.done.then(() => { if (!cleaning) controller.abort(); }, () => { if (!cleaning) controller.abort(); });
    } else for (let index = 0; index < plan.localPorts.api.length; index++) {
      await checkPins();
      const forward = ['-L', '127.0.0.1:' + plan.localPorts.api[index] + ':127.0.0.1:' + ready.serverApiPort];
      if (index === 0) forward.push('-L', '127.0.0.1:' + plan.localPorts.control + ':127.0.0.1:' + ready.serverControlPort);
      const args = [...sshArguments(plan), '-N', ...forward, host];
      const tunnel = overrides.tunnel ? await overrides.tunnel(index, args, controller.signal)
        : run('/usr/bin/ssh', args, { timeoutMs: (900 + plan.remotePlan.seconds + 600) * 1000, signal: controller.signal });
      handles.push(tunnel);
      tunnel.done.then(() => { if (!cleaning) controller.abort(); }, () => { if (!cleaning) controller.abort(); });
      // Complete one authenticated carrier before opening the next SSH handshake.
      const single = { ...plan, localPorts: { api: [plan.localPorts.api[index]], control: plan.localPorts.control } };
      await wait(async () => {
        if (tunnel.ended || monitor.ended) fail('carrier-ended-before-ready');
        try { await (overrides.attest ?? attest)(single, manifest, api, controller.signal); return true; } catch { return false; }
      }, 30000, 'carrier-readiness-timeout');
    }
    await wait(async () => {
      if (handles.some(handle => handle.ended)) fail('tunnel-or-monitor-ended-before-generators');
      try { await (overrides.attest ?? attest)(plan, manifest, api, controller.signal); return true; } catch { return false; }
    }, 60000, 'loopback-attestation-timeout');
    outcome.attestedBeforeGenerators = true;
    const reportPath = join(plan.outputDir, 'generators.json');
    const args = ['--import', 'tsx', 'scripts/load-websocket-generators.ts', '--manifest', manifestPath,
      '--control-port', String(plan.localPorts.control), '--api-ports', plan.localPorts.api.join(','), '--workers', String(plan.workers),
      '--input-mode', 'browser-window', '--sdk-websocket', 'ws', '--output', reportPath];
    const generator = run(process.execPath, args, { timeoutMs: (plan.remotePlan.seconds + Math.ceil(plan.remotePlan.clients / 20) + 210) * 1000,
      signal: controller.signal, maximum: maximumReport, onProgress: progress }); handles.push(generator);
    let result;
    try { result = await generator.done; } finally { generatorCompletedAtMs = wallNow(); }
    outcome.generatorExitCode = result.code;
    if (result.code !== 0) fail('generator-checks-failed');
    await wait(async () => {
      const status = await remote('status', expectedId, controller.signal); checkOwnedStatus(plan, status, expectedId);
      if (status.phase === 'failed') fail('stand-supervisor-failed');
      return status.phase === 'ended' && status.stopConfirmed && status.privateFixtureGone ? status : false;
    }, 60000, 'stand-completion-timeout');
    const resourceResult = await monitor.done; outcome.resourceMonitorExitCode = resourceResult.code;
    if (resourceResult.code !== 0) fail('resource-monitor-failed');
  } catch (error) { outcome.failure = safeError(error); }
  finally {
    cleaning = true; clearTimeout(timer);
    // Cleanup receives its own bounded operations even after the work signal is aborted.
    try {
      if (!cleanupAuthorized) fail('remote-cleanup-not-authorized');
      const stopped = await remote('stop', expectedId);
      const final = await remote('status', expectedId); checkOwnedStatus(plan, final, expectedId);
      outcome.stopConfirmed = stopped.stopConfirmed === true && final.stopConfirmed === true
        && ['created', 'exited', 'dead', 'missing'].includes(final.containerState);
      outcome.remotePrivateFixtureGone = stopped.privateFixtureGone === true && final.privateFixtureGone === true;
      if (plan.transport === 'direct-tls' && gateway) outcome.tlsGatewayFinal = gatewayProvenance(checkTlsGatewayStatus(plan,
        await remote('tls-status', expectedId), expectedId, outcome.standRunId, gateway));
    } catch { outcome.stopConfirmed = false; outcome.remotePrivateFixtureGone = false; }
    if (monitor && outcome.resourceMonitorExitCode === undefined) {
      let timeout;
      try {
        const result = await Promise.race([monitor.done, new Promise((_, reject) => { timeout = setTimeout(() => reject(new StageError('monitor-cleanup-timeout')), 12000); })]);
        outcome.resourceMonitorExitCode = result.code;
      } catch { outcome.resourceMonitorExitCode = null; } finally { clearTimeout(timeout); }
    }
    const stopped = await Promise.all(handles.map(async handle => { try { return await handle.stop(); } catch { return false; } }));
    outcome.ownedGroupsStopped = stopped.every(value => value === true);
    if (tlsProxy) {
      try { outcome.tlsProxyExitCode = (await bounded(tlsProxy.done, 5000, 'tls-proxy-cleanup-timeout')).code; }
      catch { outcome.tlsProxyExitCode = null; }
    }
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
    outcome.localPrivateFixtureGone = !temporary || await lstat(temporary).then(() => false, error => error.code === 'ENOENT');
    const artifacts = ['server', 'state', 'guardian', 'resourceSummary', 'resourceSamples', ...(plan.transport === 'direct-tls' ? ['tlsGateway'] : [])];
    for (const kind of artifacts) {
      let stage = 'copy';
      try {
        let data = await copyArtifact(kind);
        if (kind === 'guardian') for (let attempt = 0; attempt < 12; attempt++) {
          stage = 'parse'; if (JSON.parse(data.toString()).phase === 'ended') break;
          await delay(1000); stage = 'copy'; data = await copyArtifact(kind);
        }
        stage = 'validate';
        if (data.length > (files.get(kind)?.[1] ?? maximumReport)) fail('artifact-download-limit');
        stage = 'parse';
        if (kind === 'resourceSamples') {
          const rows = data.toString().trim().split('\n').map(line => JSON.parse(line));
          stage = 'validate'; outcome.resourceCoverage = resourceCoverage(plan, reports.server, reports.resourceSummary, rows, expectedId);
        } else {
          const value = JSON.parse(data.toString());
          stage = 'validate'; if (kind === 'tlsGateway') checkTlsFailureClassification(value);
          if (/(?:"(?:secret|tokens|password|authorization|sessionHash|Env|cmdline)"\s*:)/i.test(data.toString())) fail('secret-bearing-report-refused');
          reports[kind] = value;
        }
        stage = 'write';
        await writeFile(join(plan.outputDir, kind + (kind === 'resourceSamples' ? '.jsonl' : '.json')), data, { mode: 0o600, flag: 'wx' });
      } catch (error) { recordArtifactError(kind, stage, error); }
    }
    let generatorStage = 'read';
    try {
      const data = await privateFile(join(plan.outputDir, 'generators.json'), maximumReport); generatorStage = 'parse';
      reports.generator = JSON.parse(data.toString());
    } catch (error) { recordArtifactError('generator', generatorStage, error); }
    outcome.localMeasurementWindow = localMeasurementWindow(plan, measurePhaseObservedAtMs, generatorCompletedAtMs, reports.generator);
    if (tlsProxyOutput) {
      let stage = 'read';
      try {
        const data = await privateFile(tlsProxyOutput, 65536, 0o600); stage = 'parse'; reports.tlsProxy = JSON.parse(data.toString());
      } catch (error) { recordArtifactError('tlsProxy', stage, error); }
    }
    if (reports.tlsProxy) {
      let stage = 'read';
      try {
        const diagnostics = await privateFile(tlsProxyDiagnosticsPath, maximumProxyDiagnostics, 0o600);
        stage = 'validate';
        outcome.tlsProxyDiagnostics = validateTlsProxyDiagnostics(plan, diagnostics, reports.tlsProxy, outcome.localMeasurementWindow);
      } catch (error) { recordArtifactError('tlsProxyDiagnostics', stage, error); }
      try {
        outcome.tlsProxyFinal = checkTlsProxyFinished(plan, reports.tlsProxy); outcome.tlsProxyFinalValidated = true;
      } catch (error) { recordArtifactError('tlsProxy', 'validate', error); }
    }
    process.off('SIGINT', abort); process.off('SIGTERM', abort);
  }
  const result = { ...outcome, ...assessDedicatedStage(plan, outcome, reports) };
  await writeFile(join(plan.outputDir, 'outcome.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return result;
}

async function main() {
  const values = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (key === '--help') { console.log('Local dedicated test orchestration: node scripts/run-dedicated-websocket-stage.mjs --plan /private/path/stage.json [--direct-interface en0]\nThe private plan contains remotePlan, workers, localPorts {api:[ports],control:port}, outputDir, knownHostsFile and knownHostsSha256. Optional transport:"direct-tls" requires remotePlan.tlsGateway and directTls.proxySha256; it uses four local API listeners with one TLS upstream per accepted TCP and one SSH control tunnel. Existing remote plan/root/image must already be prepared. No VPN routes are changed.'); return; }
    if (!['--plan', '--direct-interface'].includes(key) || values[key] || !process.argv[index + 1]) fail('invalid-runner-cli');
    values[key] = process.argv[++index];
  }
  if (!values['--plan']) fail('private-local-plan-required');
  const path = resolve(values['--plan']), parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700 || await realpath(dirname(path)) !== dirname(path)) fail('private-plan-directory-required');
  const plan = JSON.parse((await privateFile(path, 65536, 0o600)).toString());
  const result = await runDedicatedWebsocketStage(plan, { directInterface: values['--direct-interface'],
    progress: value => console.error(JSON.stringify(value)) });
  console.log(JSON.stringify({ runId: result.runId, outputDir: plan.outputDir, ok: result.ok, verdict: result.verdict,
    failure: result.failure, checks: result.checks, stopConfirmed: result.stopConfirmed, ownedGroupsStopped: result.ownedGroupsStopped }));
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: safeError(error) })); process.exitCode = 1;
});
