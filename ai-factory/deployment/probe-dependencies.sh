#!/bin/bash
set -euo pipefail

deployment_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apparmor_policy="$deployment_dir/worker-apparmor"
seccomp_policy="$deployment_dir/worker-seccomp.json"
profile_name=royal-ai-worker-test
container_name="royal-ai-dependencies-smoke-$$"
probe_label="dependencies-$$-$RANDOM"
runtime_image=royal-ai-worker:current
workspace_volume=royal-ai_factory_workspaces
profile_loaded=0

if [ "$(id -u)" != 0 ]; then
  echo 'Run this diagnostic on the Docker host as root.' >&2
  exit 1
fi
if grep -q -E "^${profile_name} " /sys/kernel/security/apparmor/profiles; then
  echo 'The diagnostic profile already exists. Refusing to replace it.' >&2
  exit 1
fi
if docker container inspect "$container_name" >/dev/null 2>&1; then
  echo 'The diagnostic container already exists. Refusing to replace it.' >&2
  exit 1
fi
grep -Fqx 'profile royal-ai-worker-test flags=(attach_disconnected,mediate_deleted) {' "$apparmor_policy"
apparmor_parser -Q -T "$apparmor_policy"
docker volume inspect "$workspace_volume" >/dev/null
if [ "$(docker image inspect "$runtime_image" --format '{{.Architecture}}')" != amd64 ]; then
  echo 'This candidate namespace allowlist requires amd64.' >&2
  exit 1
fi

cleanup() {
  probe_status=$?
  trap - EXIT INT TERM
  container_label=$(docker container inspect "$container_name" --format '{{index .Config.Labels "royal.ai.dependency-probe"}}' 2>/dev/null || true)
  if [ "$container_label" = "$probe_label" ]; then
    if ! docker rm -f "$container_name" >/dev/null 2>&1; then
      echo 'Diagnostic container cleanup failed. Remove only the dependency probe container before continuing.' >&2
      probe_status=1
    fi
  fi
  if [ "$profile_loaded" = 1 ]; then
    if ! apparmor_parser -R "$apparmor_policy"; then
      echo 'Diagnostic profile cleanup failed. Remove royal-ai-worker-test before continuing.' >&2
      probe_status=1
    fi
  fi
  exit "$probe_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

apparmor_parser -a "$apparmor_policy"
profile_loaded=1

timeout --kill-after=5s 480s docker run --rm -i --name "$container_name" \
  --label "royal.ai.dependency-probe=$probe_label" \
  --network bridge --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt "apparmor=$profile_name" \
  --security-opt "seccomp=$seccomp_policy" \
  --memory 1024m --pids-limit 256 --cpus 1 \
  --mount "type=volume,src=$workspace_volume,dst=/workspaces" \
  --env NODE_ENV=test --env HOME=/tmp/factory-test-home \
  --env CODEX_HOME=/tmp/factory-test-home/.codex \
  --env PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  --entrypoint node "$runtime_image" --input-type=module <<'NODE'
import { mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { Workspaces, sandboxedCommand } from '/app/lib/workspaces.mjs';

const manager = new Workspaces({ source: '/project', directory: '/workspaces' });
const id = '00000000-0000-4000-8000-000000000001';
const path = manager.path(id);
const errors = new Set(['ENETUNREACH', 'EACCES', 'EPERM']);
let commit;
let fingerprint;
let failed = false;
const detail = value => String(value ?? '').slice(-1200);

function proxyProgram(check, target) {
  return `
import net from 'node:net';
const check = ${JSON.stringify(check)};
const target = ${JSON.stringify(target)};
let socket, timer, finished = false;
const finish = proof => {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  socket?.destroy();
  console.log(JSON.stringify({check,target,...proof}));
  process.exitCode = proof.status === 403 ? 0 : 1;
};
const value = process.env.HTTP_PROXY || process.env.http_proxy;
if (!value) {
  finish({error:'missing_proxy'});
} else {
  const proxy = new URL(value);
  if (proxy.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(proxy.hostname)) {
    finish({error:'unexpected_proxy'});
  } else {
    let headers = '';
    socket = net.connect({host:proxy.hostname,port:Number(proxy.port || 80)});
    socket.setEncoding('latin1');
    timer = setTimeout(() => finish({error:'TIMEOUT'}),3000);
    socket.on('connect', () => socket.write('GET '+target+' HTTP/1.1\\r\\nHost: '+new URL(target).host+'\\r\\nConnection: close\\r\\n\\r\\n'));
    socket.on('data', chunk => {
      const remaining = 4096 - headers.length;
      headers += chunk.slice(0,remaining);
      const end = headers.indexOf('\\r\\n');
      if (end !== -1) {
        const match = new RegExp('^HTTP/1[.][01] ([0-9]{3})').exec(headers.slice(0,end));
        finish(match ? {status:Number(match[1])} : {error:'invalid_status_line'});
      } else if (headers.length === 4096) {
        finish({error:'headers_too_large'});
      }
    });
    socket.on('end', () => finish({error:'incomplete_status_line'}));
    socket.on('error', error => finish({error:error.code || 'connection_failed'}));
  }
}
`;
}

async function prove(check, program, accepts) {
  try {
    const result = await sandboxedCommand(process.execPath, ['--input-type=module', '-e', program], {
      cwd: path, dependencyInstall: true, timeoutMs: 20000, maxBytes: 64 * 1024,
    });
    const proofs = result.output.split(/\r?\n/).flatMap(line => {
      try {
        const value = JSON.parse(line);
        return value?.check === check ? [value] : [];
      } catch { return []; }
    });
    const proof = proofs.length === 1 ? proofs[0] : null;
    const passed = result.passed && proof !== null && accepts(proof);
    console.log(JSON.stringify({ check, passed, proof, exit_code: result.exit_code,
      ...(passed ? {} : { detail: detail(result.output) }) }));
    if (!passed) failed = true;
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ check, passed: false, detail: detail(error.message) }));
  }
}

try {
  if (process.getuid() !== 1000) throw new Error('The dependency probe must use the unprivileged worker user.');
  if (await realpath(path) !== path || await realpath(`${path}/.git`) !== `${path}/.git` ||
      !(await lstat(`${path}/.git/HEAD`)).isFile()) {
    throw new Error('The existing fixture must be an initialized Git workspace without path redirection.');
  }
  commit = await manager.head(path);
  fingerprint = await manager.fingerprint(path);
  await mkdir(process.env.CODEX_HOME, { recursive: true });
  const authFixture = `${process.env.CODEX_HOME}/dependency-probe-fixture`;
  await writeFile(authFixture, 'Dummy fixture, not a credential.', { mode: 0o600 });

  const control = await new Promise(resolve => {
    const request = http.get('http://example.com/', response => {
      const remoteIP = response.socket.remoteAddress;
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, remoteIP }));
      response.on('error', error => resolve({ error: error.code ?? 'response_failed' }));
    });
    request.setTimeout(8000, () => request.destroy());
    request.on('error', error => resolve({ error: error.code ?? 'request_failed' }));
  });
  const controlPassed = control.status === 200 && net.isIP(control.remoteIP ?? '') !== 0;
  console.log(JSON.stringify({ check: 'outer_external_control', passed: controlPassed, ...control }));
  if (!controlPassed) throw new Error('The outer HTTP 200 control and its actual remote IP are required.');

  const prepared = await manager.prepare(id, { reinstall: true, signal: AbortSignal.timeout(300000) });
  if (prepared !== path) throw new Error('Dependency preparation returned an unexpected workspace.');
  console.log(JSON.stringify({ check: 'dependency_install', passed: true }));

  await prove('setup_proxy_external_denial',
    proxyProgram('setup_proxy_external_denial', 'http://example.com/'),
    proof => proof.status === 403 && proof.target === 'http://example.com/');
  await prove('setup_proxy_localhost_denial',
    proxyProgram('setup_proxy_localhost_denial', 'http://localhost:12345/'),
    proof => proof.status === 403 && proof.target === 'http://localhost:12345/');

  await prove('setup_direct_ip_denial', `
import net from 'node:net';
for (const key of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy']) delete process.env[key];
const remoteIP = ${JSON.stringify(control.remoteIP)};
const accepted = new Set(['ENETUNREACH','EACCES','EPERM']);
const socket = net.connect({host:remoteIP,port:80});
let finished = false;
const finish = code => {
  if (finished) return;
  finished = true; socket.destroy();
  console.log(JSON.stringify({check:'setup_direct_ip_denial',remoteIP,code}));
  process.exitCode = accepted.has(code) ? 0 : 1;
};
socket.on('connect', () => finish('ALLOWED'));
socket.on('error', error => finish(error.code || 'connection_failed'));
socket.setTimeout(3000, () => finish('TIMEOUT'));
`, proof => proof.remoteIP === control.remoteIP && errors.has(proof.code));

  await prove('isolated_loopback_bind', `
import net from 'node:net';
const server = net.createServer();
const finish = code => {
  console.log(JSON.stringify({check:'isolated_loopback_bind',code}));
  process.exitCode = code === 'ALLOWED' ? 0 : 1;
};
server.on('error', error => finish(error.code || 'listen_failed'));
server.listen(0,'127.0.0.1', () => server.close(() => finish('ALLOWED')));
`, proof => proof.code === 'ALLOWED');

  await prove('setup_auth_fixture_denial', `
import {readFileSync} from 'node:fs';
try {
  readFileSync(${JSON.stringify(authFixture)});
  console.log(JSON.stringify({check:'setup_auth_fixture_denial',code:'ALLOWED'}));
  process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({check:'setup_auth_fixture_denial',code:error.code}));
  process.exitCode = ['EACCES','EPERM','ENOENT'].includes(error.code) ? 0 : 1;
}
`, proof => ['EACCES', 'EPERM', 'ENOENT'].includes(proof.code));
} catch (error) {
  failed = true;
  console.log(JSON.stringify({ check: 'dependency_probe', passed: false, detail: detail(error.message) }));
} finally {
  if (commit && fingerprint) {
    try {
      const afterCommit = await manager.head(path);
      const afterFingerprint = await manager.fingerprint(path);
      const unchanged = afterCommit === commit && afterFingerprint === fingerprint;
      console.log(JSON.stringify({ check: 'workspace_unchanged', passed: unchanged, commit }));
      if (!unchanged) failed = true;
    } catch (error) {
      failed = true;
      console.log(JSON.stringify({ check: 'workspace_unchanged', passed: false, detail: detail(error.message) }));
    }
  }
}
console.log(JSON.stringify({ check: 'dependency_probe_complete', passed: !failed }));
process.exitCode = failed ? 1 : 0;
NODE

echo 'Dependency setup checks passed; the EXIT trap now removes the diagnostic profile.'
