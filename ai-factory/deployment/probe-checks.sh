#!/bin/bash
set -euo pipefail

deployment_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apparmor_policy="$deployment_dir/worker-apparmor"
seccomp_policy="$deployment_dir/worker-seccomp.json"
profile_name=royal-ai-worker-test
container_name="royal-ai-checks-smoke-$$"
runtime_image=royal-ai-worker:current
workspace_volume=royal-ai_factory_workspaces
profile_loaded=0
checks_mode=${ROYAL_CHECKS_PROBE_MODE:-full}
case "$checks_mode" in
  full|native|postgres|unix) ;;
  *) echo 'Only full/native/postgres/unix diagnostic modes are supported.' >&2; exit 1 ;;
esac

if [ "$(id -u)" != 0 ]; then
  echo 'Run this diagnostic on the Docker host as root.' >&2
  exit 1
fi
if grep -q -E "^${profile_name} " /sys/kernel/security/apparmor/profiles; then
  echo 'The diagnostic profile already exists. Refusing to replace it.' >&2
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
  docker rm -f "$container_name" >/dev/null 2>&1 || true
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

timeout --kill-after=5s 900s docker run --rm -i --name "$container_name" \
  --network none --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt "apparmor=$profile_name" \
  --security-opt "seccomp=$seccomp_policy" \
  --memory 1024m --pids-limit 256 --cpus 1 \
  --mount "type=volume,src=$workspace_volume,dst=/workspaces" \
  --env NODE_ENV=test --env HOME=/tmp/factory-test-home \
  --env CODEX_HOME=/tmp/factory-test-home/.codex \
  --env PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  --env "ROYAL_CHECKS_PROBE_MODE=$checks_mode" \
  --entrypoint node "$runtime_image" --input-type=module <<'NODE'
import { mkdir, lstat, realpath, readlink, symlink } from 'node:fs/promises';
import { Workspaces, sandboxedCommand, command } from '/app/lib/workspaces.mjs';
import { permissionArgs } from '/app/lib/codex.mjs';

if (process.getuid() !== 1000) throw new Error('The checks must use the unprivileged worker user.');
const manager = new Workspaces({ source: '/project', directory: '/workspaces' });
const path = manager.path('00000000-0000-4000-8000-000000000001');
for (const name of ['.git','.agents','.codex','.aws','.factory']) await mkdir(`${path}/${name}`, { recursive: true });
await mkdir(process.env.CODEX_HOME, { recursive: true });
const readiness = await sandboxedCommand('/bin/true', [], {cwd:'/tmp',timeoutMs:15000});
console.log(JSON.stringify({check:'exact_worker_readiness',passed:readiness.passed,detail:readiness.output.slice(-1200)}));
if (!readiness.passed) throw new Error('The exact worker readiness command failed.');
const nativeLib = `${path}/node_modules/@embedded-postgres/linux-x64/native/lib`;
if (await realpath(nativeLib) !== nativeLib) throw new Error('The fixture native library directory must not escape its package.');
for (const [target, source] of [
  ['libpq.so.5','libpq.so.5.17'],
  ['libicuuc.so.60','libicuuc.so.60.2'],
  ['libicui18n.so.60','libicui18n.so.60.2'],
  ['libicudata.so.60','libicudata.so.60.2'],
]) {
  const sourcePath = `${nativeLib}/${source}`;
  const targetPath = `${nativeLib}/${target}`;
  if (!(await lstat(sourcePath)).isFile() || await realpath(sourcePath) !== sourcePath) throw new Error('The fixture library source must be a regular bundled file.');
  try {
    if (!(await lstat(targetPath)).isSymbolicLink() || await readlink(targetPath) !== source || await realpath(targetPath) !== sourcePath) throw new Error('The fixture library link is unexpected.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(source, targetPath);
  }
}
const commit = await manager.head(path);
const before = await manager.fingerprint(path);
const native = await sandboxedCommand('/usr/bin/env', [`LD_LIBRARY_PATH=${nativeLib}`, `${nativeLib}/../bin/initdb`, '--version'], { cwd: path, timeoutMs: 20000 });
console.log(JSON.stringify({check:'native_pg_loader_with_inside_env',passed:native.passed,detail:native.output.slice(-1200)}));
if (process.env.ROYAL_CHECKS_PROBE_MODE === 'native') process.exit(native.passed ? 0 : 1);
if (!native.passed) throw new Error('The native PostgreSQL loader control failed.');
if (process.env.ROYAL_CHECKS_PROBE_MODE === 'unix') {
  const sockets = ['/tmp/nile-play-api-exact-probe/play.sock','/tmp/nile-deposit-api-exact-probe/play.sock'];
  for (const socket of sockets) await mkdir(socket.slice(0,socket.lastIndexOf('/')), {recursive:true});
  async function unixDiagnostic() {
    const net = await import('node:net');
    for (const socketPath of JSON.parse(process.argv[1])) {
      const server = net.createServer(socket => socket.end('public-dummy-fixture'));
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
      const body = await new Promise((resolve,reject)=>{let body='';const socket=net.connect(socketPath);socket.on('data',chunk=>{body+=chunk;});socket.once('end',()=>resolve(body));socket.once('error',reject);socket.setTimeout(3000,()=>socket.destroy(new Error('Socket control timed out')));});
      await new Promise(resolve=>server.close(resolve));
      if (body !== 'public-dummy-fixture') throw new Error('Unexpected socket control response.');
      console.log(JSON.stringify({socket:socketPath,bind_and_connect:true}));
    }
  }
  const program='('+unixDiagnostic.toString()+')().then(()=>process.exit(0),error=>{console.error(JSON.stringify({error:error.code||String(error)}));process.exit(1);});';
  const socketMap='{'+sockets.map(socket=>JSON.stringify(socket)+'="allow"').join(',')+'}';
  const result=await command('codex',['sandbox','-P','royal-tester','-C',path,...permissionArgs('tester'),'-c','permissions.royal-tester.network.unix_sockets='+socketMap,'--',process.execPath,'--input-type=module','-e',program,JSON.stringify(sockets)],{cwd:path,timeoutMs:20000});
  console.log(JSON.stringify({check:'exact_unix_socket_bind_connect',passed:result.passed,sockets,detail:result.output.slice(-5000)}));
  process.exit(result.passed?0:1);
}
if (process.env.ROYAL_CHECKS_PROBE_MODE === 'postgres') {
  async function postgresDiagnostic() {
    const { default: EmbeddedPostgres } = await import(process.argv[1] + '/node_modules/embedded-postgres/dist/index.js');
    const { mkdtemp } = await import('node:fs/promises');
    const { createServer } = await import('node:net');
    const server = createServer();
    await new Promise((resolve,reject) => { server.once('error',reject);server.listen(0,'127.0.0.1',resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    const directory = await mkdtemp('/tmp/royal-pg-diagnostic-');
    const log = message => console.log(JSON.stringify({native_log:String(message).slice(0,1200)}));
    const postgres = new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password:'isolated-dummy-fixture-password',persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1','-c','unix_socket_directories='],onLog:log,onError:log});
    try {
      await postgres.initialise();console.log(JSON.stringify({phase:'initialise',passed:true}));
      await postgres.start();console.log(JSON.stringify({phase:'start',passed:true}));
      await postgres.createDatabase('royal_test');console.log(JSON.stringify({phase:'create_database',passed:true}));
    } finally {
      await postgres.stop().catch(() => {});
    }
  }
  const program = '(' + postgresDiagnostic.toString() + ')().then(()=>process.exit(0),error=>{console.error(String(error));process.exit(1);});';
  const diagnostic = await sandboxedCommand('/usr/bin/env',[`LD_LIBRARY_PATH=${nativeLib}`,process.execPath,'--input-type=module','-e',program,path],{cwd:path,timeoutMs:60000});
  const phases = new Set();
  for (const line of diagnostic.output.split('\n')) { try { const value=JSON.parse(line);if(value.phase&&value.passed===true)phases.add(value.phase); } catch {} }
  const passed = diagnostic.passed && ['initialise','start','create_database'].every(phase=>phases.has(phase));
  console.log(JSON.stringify({check:'postgres_initialise_start_control',passed,phases:[...phases],detail:diagnostic.output.slice(-10000)}));
  process.exit(passed ? 0 : 1);
}
const checks = await manager.checks(path, { signal: AbortSignal.timeout(840000) });
const unchanged = await manager.head(path) === commit && await manager.fingerprint(path) === before;
const passed = unchanged && checks.length === 2 && checks.every(check => check.passed);
console.log(JSON.stringify({ commit, unchanged, passed, checks: checks.map(check => ({
  name: check.name, passed: check.passed, detail: check.detail.slice(check.passed ? -1200 : -12000),
})) }));
process.exitCode = passed ? 0 : 1;
NODE

if [ "$checks_mode" != full ]; then
  echo 'Native PostgreSQL diagnostic passed; the EXIT trap now removes the diagnostic profile.'
else
  echo 'Project checks passed; the EXIT trap now removes the diagnostic profile.'
fi
