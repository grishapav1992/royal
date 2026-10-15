#!/usr/bin/env python3
"""Supervise one prebuilt, loopback-only stand without production mounts."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import subprocess
import time
import urllib.request

HEALTH = 'https://stealth-spark-gokmxooi.expresshost.cloud/healthz'
INACTIVE = {'created', 'exited', 'dead'}
HEX = re.compile(r'[a-f0-9]{64}')


class Refused(RuntimeError):
    pass


def relative(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_./-]{1,160}', value):
        raise Refused('invalid-relative-path')
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {'', '.', '..'} for part in value.split('/')):
        raise Refused('invalid-relative-path')
    return path


def private_json(path, limit=65536):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > limit:
        raise Refused('private-plan-required')
    return json.loads(path.read_text())


def validate(plan):
    run = plan.get('runId')
    if plan.get('protocol') != 1 or not isinstance(run, str) or not re.fullmatch(r's8-[A-Za-z0-9_-]{8,48}', run):
        raise Refused('invalid-run-id-or-protocol')
    root = '/opt/royal-load-' + run
    if plan.get('ownedRoot') != root or plan.get('containerName') != 'royal-load-' + run + '-test':
        raise Refused('invalid-owned-target')
    stage = plan.get('stage', {})
    if type(stage.get('clients')) is not int or stage['clients'] not in {100, 250, 500, 1000, 1200}:
        raise Refused('invalid-stage-clients')
    if type(stage.get('seconds')) is not int or not 1 <= stage['seconds'] <= 1800 or stage.get('inputMode') != 'browser-window' or stage.get('workers') != 4:
        raise Refused('invalid-stage-workload')
    ports = plan.get('localPorts', {})
    if any(type(ports.get(key)) is not int or not 1024 <= ports[key] <= 65535 for key in ('api', 'control')) or ports['api'] == ports['control']:
        raise Refused('invalid-loopback-ports')
    if not HEX.fullmatch(str(plan.get('bundleSha256', ''))):
        raise Refused('invalid-bundle-digest')
    required_runtime = {'frozen-server.mjs', 'dist-load/cluster.mjs', 'dist-load/database.mjs', 'dist-load/metrics.mjs', 'dist-load/metadata.json', 'runtime-check.mjs', 'bin/caddy', 'bin/redis-server'}
    hashes = plan.get('runtimeFiles', {})
    if not isinstance(hashes, dict) or set(hashes) != required_runtime or any(not HEX.fullmatch(str(value)) for value in hashes.values()) or hashes['frozen-server.mjs'] != plan['bundleSha256']:
        raise Refused('runtime-file-digests-required')
    supervisor = plan.get('supervisor', {})
    if supervisor.get('path') != 'load-remote-stand.py' or not HEX.fullmatch(str(supervisor.get('sha256', ''))) or not HEX.fullmatch(str(plan.get('guardSha256', ''))):
        raise Refused('supervisor-and-guard-digests-required')
    expected = 'run/stage-' + str(stage['clients'])
    if plan.get('manifestPath') != expected + '-private.json':
        raise Refused('invalid-manifest-path')
    artifacts = plan.get('artifacts', {})
    for key, suffix in {'server': '-server.json', 'guard': '-guard.json', 'guardSamples': '-guard.jsonl', 'supervisor': '-supervisor.json'}.items():
        if artifacts.get(key) != expected + suffix:
            raise Refused('invalid-artifact-path')
    for value in [plan['manifestPath'], *artifacts.values()]:
        relative(value)
    for service in ('game', 'caddy'):
        anchor = plan.get('production', {}).get(service, {})
        if not HEX.fullmatch(str(anchor.get('Id', ''))) or not re.fullmatch(r'sha256:[a-f0-9]{64}', str(anchor.get('Image', ''))) or not isinstance(anchor.get('StartedAt'), str):
            raise Refused('invalid-production-anchor')
    return plan


def load_plan(path):
    plan = validate(private_json(path))
    root = Path(plan['ownedRoot'])
    if path.parent != root or path.name != 'stand-plan.json':
        raise Refused('plan-outside-owned-root')
    if root.is_symlink() or not root.is_dir() or root.stat().st_uid != 0 or stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise Refused('private-owned-root-required')
    marker = root / 'owner'
    if marker.is_symlink() or not marker.is_file() or marker.read_text().strip() != plan['runId']:
        raise Refused('owner-marker-mismatch')
    for name in ('runtime', 'postgres', 'home', 'run'):
        target = root / name
        if target.is_symlink() or not target.is_dir():
            raise Refused('prepared-owned-directory-required')
    if path.stat().st_uid != 0:
        raise Refused('root-owned-plan-required')
    if digest(root / 'load-remote-stand.py') != plan['supervisor']['sha256'] or digest(root / 'load-host-guard.py') != plan['guardSha256']:
        raise Refused('supervisor-or-guard-digest-mismatch')
    return plan


def command(args, timeout=15, limit=131072):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
                            env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/root'})
    if result.returncode or len(result.stdout) > limit:
        raise Refused('bounded-command-failed')
    return result.stdout.decode().strip()


def write_private(path, value):
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
        json.dump(value, output, separators=(',', ':'))
    os.replace(temporary, path)


def digest(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
        raise Refused('bounded-regular-file-required')
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


class Stand:
    def __init__(self, plan, plan_path):
        self.plan, self.plan_path = plan, plan_path
        self.root, self.run, self.name = Path(plan['ownedRoot']), plan['runId'], plan['containerName']
        self.state_path = self.root / ('run/stage-' + str(plan['stage']['clients']) + '-supervisor-state.json')

    @contextmanager
    def lifecycle(self):
        descriptor = os.open(self.root / 'lifecycle.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
                raise Refused('private-lifecycle-lock-required')
            deadline = time.monotonic() + 25
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() > deadline:
                        raise Refused('lifecycle-lock-timeout')
                    time.sleep(0.1)
            yield
        finally:
            os.close(descriptor)

    def require_not_cancelled(self):
        marker = self.root / 'stop-requested.json'
        if marker.exists() or marker.is_symlink():
            raise Refused('stop-requested-before-start')

    def inspect(self, allow_missing=False):
        identifiers = command(['docker', 'ps', '--all', '--no-trunc', '--filter', 'name=^/' + self.name + '$', '--format', '{{.ID}}']).splitlines()
        if not identifiers and allow_missing:
            return None
        if len(identifiers) != 1 or not HEX.fullmatch(identifiers[0]):
            raise Refused('exact-owned-container-required')
        template = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"label":{{json (index .Config.Labels "royal.load.run-id")}},"state":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}}}'
        value = json.loads(command(['docker', 'inspect', '--format', template, identifiers[0]]))
        if value['Id'] != identifiers[0] or value['Name'] != '/' + self.name or value['label'] != self.run or value['Image'] != self.plan['production']['game']['Image']:
            raise Refused('container-ownership-changed')
        if self.state_path.exists():
            state = private_json(self.state_path)
            if state.get('containerId') != value['Id'] or state.get('runId') != self.run:
                raise Refused('container-id-changed')
        return value

    def stop_owned(self):
        value = self.inspect(allow_missing=True)
        if value and value['state'] not in INACTIVE:
            try:
                command(['docker', 'stop', '-t', '5', value['Id']], timeout=12)
            except (Refused, subprocess.TimeoutExpired):
                value = self.inspect()
                if value['state'] not in INACTIVE:
                    command(['docker', 'kill', value['Id']], timeout=10)
            value = self.inspect()
        if value and value['state'] not in INACTIVE:
            raise Refused('test-stop-unconfirmed')
        return value

    def anchors(self):
        for name in ('game', 'caddy'):
            expected = self.plan['production'][name]
            value = json.loads(command(['docker', 'inspect', '--format', '{"Id":{{json .Id}},"Image":{{json .Image}},"StartedAt":{{json .State.StartedAt}},"Status":{{json .State.Status}}}', 'royal-' + name + '-1']))
            if any(value[key] != expected[key] for key in ('Id', 'Image', 'StartedAt')) or value['Status'] != 'running':
                raise Refused('production-anchor-changed')

    def host_gate(self):
        previous = None
        for _ in range(10):
            available = next(int(line.split()[1]) / 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
            if available < 1396:
                raise Refused('insufficient-host-memory-before-stand')
            cpu = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
            current = (sum(cpu), cpu[3] + cpu[4])
            if previous:
                total = current[0] - previous[0]
                if total <= 0 or 100 * (1 - (current[1] - previous[1]) / total) >= 70:
                    raise Refused('insufficient-host-cpu-before-stand')
            previous = current
            time.sleep(1)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(HEALTH, timeout=3) as response:
            if response.status != 200 or response.geturl() != HEALTH:
                raise Refused('public-health-unavailable')

    def create(self):
        self.require_not_cancelled()
        if self.inspect(allow_missing=True):
            raise Refused('owned-container-already-exists')
        if self.state_path.exists() or any((self.root / value).exists() for value in [self.plan['manifestPath'], *self.plan['artifacts'].values()]):
            raise Refused('stage-artifact-already-exists')
        runtime = self.root / 'runtime'
        for name, expected in self.plan['runtimeFiles'].items():
            if digest(runtime / name) != expected:
                raise Refused('prepared-runtime-digest-mismatch')
        self.anchors()
        self.host_gate()
        self.anchors()
        stage = self.plan['stage']
        launch = "const argv=process.argv.slice(1);process.argv=[process.execPath,'/app/royal-load/runtime-check.mjs','--load-dir','/app/royal-load/dist-load','--postgres-dir','/app/node_modules/@embedded-postgres/linux-x64'];await import('/app/royal-load/runtime-check.mjs');if(process.exitCode)process.exit(process.exitCode);process.argv=[process.execPath,...argv];await import('/app/royal-load/dist-load/database.mjs');"
        args = ['docker', 'create', '--name', self.name, '--label', 'royal.load.run-id=' + self.run,
                '--cpus', '0.5', '--cpu-shares', '128', '--memory', '896m', '--memory-swap', '896m', '--pids-limit', '128',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--read-only', '--network', 'host', '--entrypoint', 'node',
                '--workdir', '/app/royal-load', '--tmpfs', '/tmp:rw,exec,nosuid,size=512m,uid=1000,gid=1000',
                '--mount', 'type=bind,src=' + str(runtime) + ',dst=/app/royal-load,readonly',
                '--mount', 'type=bind,src=' + str(self.root / 'postgres') + ',dst=/app/node_modules/@embedded-postgres/linux-x64,readonly',
                '--mount', 'type=bind,src=' + str(self.root / 'run') + ',dst=/app/royal-load/run',
                '--mount', 'type=bind,src=' + str(self.root / 'home') + ',dst=/app/royal-load/home',
                '--env', 'NODE_ENV=test', '--env', 'HOME=/app/royal-load/home', '--env', 'ROYAL_REDIS_SERVER_BINARY=/app/royal-load/bin/redis-server',
                self.plan['production']['game']['Image'], '--input-type=module', '-e', launch, '/app/royal-load/dist-load/database.mjs', '/app/royal-load/dist-load/cluster.mjs',
                '--metrics-script', '/app/royal-load/dist-load/metrics.mjs', '--server-bundle', '/app/royal-load/frozen-server.mjs',
                '--proxy-binary', '/app/royal-load/bin/caddy', '--stand-manifest', '/app/royal-load/' + self.plan['manifestPath'],
                '--client-origin', 'http://127.0.0.1:' + str(self.plan['localPorts']['api']), '--clients', str(stage['clients']), '--seconds', str(stage['seconds']),
                '--input-mode', stage['inputMode'], '--frame-diagnostics', '--output', '/app/royal-load/' + self.plan['artifacts']['server']]
        try:
            with self.lifecycle():
                self.require_not_cancelled()
                command(args, timeout=20)
                value = self.inspect()
                write_private(self.state_path, {'runId': self.run, 'container': self.name, 'containerId': value['Id'], 'phase': 'created'})
        except BaseException:
            self.stop_owned()
            raise
        return value

    def supervise(self):
        value = self.inspect()
        summary = {'runId': self.run, 'container': self.name, 'containerId': value['Id'], 'passed': False, 'started': False, 'stopConfirmed': False, 'reason': 'supervisor-error'}
        guard = None
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        signal.signal(signal.SIGINT, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        try:
            with (self.root / 'run/guard.log').open('x') as log:
                guard = subprocess.Popen(['python3', str(self.root / 'load-host-guard.py'), '--container', self.name, '--run-id', self.run,
                    '--output', str(self.root / self.plan['artifacts']['guard']), '--max-seconds', str(self.plan['stage']['seconds'] + 600)], stdin=subprocess.DEVNULL, stdout=log, stderr=log)
                time.sleep(2)
                if guard.poll() is not None:
                    raise Refused('host-guard-not-running')
                with self.lifecycle():
                    self.require_not_cancelled()
                    self.anchors()
                    command(['docker', 'start', value['Id']])
                summary['started'] = True
                ticks = Path('/proc/' + str(guard.pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
                write_private(self.state_path, {'runId': self.run, 'container': self.name, 'containerId': value['Id'], 'pid': os.getpid(), 'guardPid': guard.pid, 'guardStartTicks': ticks, 'phase': 'running'})
                deadline = time.monotonic() + self.plan['stage']['seconds'] + 620
                while self.inspect()['state'] not in {'exited', 'dead'}:
                    if guard.poll() is not None or time.monotonic() > deadline:
                        raise Refused('guarded-stand-ended-or-timeout')
                    time.sleep(1)
                value = self.inspect()
                summary.update(containerExitCode=value['exitCode'], oomKilled=value['oomKilled'], guardExitCode=guard.wait(timeout=15))
                result = private_json(self.root / self.plan['artifacts']['guard'])
                summary['passed'] = value['exitCode'] == 0 and not value['oomKilled'] and summary['guardExitCode'] == 0 and result.get('container') == self.name and result.get('runId') == self.run and result.get('reason') == 'container-ended' and result.get('stopped') is False and result.get('samples', 0) > 0 and result.get('healthChecks', 0) > 0
                summary['reason'] = 'container-ended' if summary['passed'] else 'guard-or-container-failed'
        except BaseException as error:
            summary['reason'] = str(error) if isinstance(error, Refused) else 'supervisor-runtime-failure'
        finally:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            try:
                self.stop_owned()
                summary['stopConfirmed'] = True
            except Exception:
                summary.update(passed=False, reason='test-stop-unconfirmed')
            if guard and guard.poll() is None:
                guard.terminate()
                try:
                    guard.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    guard.kill()
                    guard.wait(timeout=5)
            write_private(self.root / self.plan['artifacts']['supervisor'], summary)
            write_private(self.state_path, {'runId': self.run, 'container': self.name, 'containerId': value['Id'], 'phase': 'ended' if summary['passed'] else 'failed'})
        return summary

    def start(self):
        child = None
        previous = {name: signal.getsignal(name) for name in (signal.SIGTERM, signal.SIGINT)}
        for name in previous:
            signal.signal(name, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        try:
            value = self.create()
            with (self.root / 'run/supervisor.log').open('x') as log:
                child = subprocess.Popen(['python3', str(self.root / 'load-remote-stand.py'), 'supervise', '--plan', str(self.plan_path)],
                                         stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                state = private_json(self.state_path)
                if child.poll() is not None or state['phase'] == 'failed':
                    raise Refused('supervisor-ended-before-start')
                if state.get('pid') == child.pid and state['phase'] == 'running':
                    return {'runId': self.run, 'container': self.name, 'containerId': value['Id'], 'phase': 'running'}
                time.sleep(0.2)
            raise Refused('supervisor-start-timeout')
        except BaseException:
            for name in previous:
                signal.signal(name, signal.SIG_IGN)
            if child and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            self.stop_owned()
            raise
        finally:
            for name, handler in previous.items():
                signal.signal(name, handler)

    def status(self):
        value = self.inspect(allow_missing=True)
        result = {'runId': self.run, 'container': self.name, 'containerId': value['Id'] if value else None, 'state': value['state'] if value else 'missing',
                  'phase': 'created', 'guardActive': False, 'ready': False, 'bundleSha256': self.plan['bundleSha256']}
        if self.state_path.exists():
            state = private_json(self.state_path)
            result['phase'] = state['phase']
            if state.get('guardPid') and state.get('guardStartTicks'):
                try:
                    fields = Path('/proc/' + str(state['guardPid']) + '/stat').read_text().rsplit(')', 1)[1].split()
                    result['guardActive'] = fields[19] == state['guardStartTicks'] and fields[0] not in {'Z', 'X', 'x'}
                except (OSError, IndexError):
                    pass
        manifest = self.root / self.plan['manifestPath']
        if value and value['state'] == 'running' and result['phase'] == 'running' and result['guardActive'] and manifest.exists():
            fixture = private_json(manifest, limit=2 * 1024 * 1024)
            if fixture.get('bundleSha256') != self.plan['bundleSha256'] or fixture.get('clients') != self.plan['stage']['clients'] or fixture.get('seconds') != self.plan['stage']['seconds'] or fixture.get('apiEndpoint') != 'http://127.0.0.1:' + str(self.plan['localPorts']['api']):
                raise Refused('manifest-attestation-failed')
            for name in ('serverApiPort', 'serverControlPort'):
                if type(fixture.get(name)) is not int or not 1024 <= fixture[name] <= 65535:
                    raise Refused('invalid-manifest-port')
            if fixture['serverApiPort'] == fixture['serverControlPort']:
                raise Refused('invalid-manifest-port')
            result.update(ready=True, standRunId=fixture['runId'], manifestSha256=digest(manifest), serverApiPort=fixture['serverApiPort'], serverControlPort=fixture['serverControlPort'])
        return result

    def stop(self, grace):
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            value = self.inspect(allow_missing=True)
            if not value or value['state'] in INACTIVE:
                break
            time.sleep(1)
        # Serialize cancellation with create/start so a delayed supervisor cannot start after stop.
        with self.lifecycle():
            write_private(self.root / 'stop-requested.json', {'runId': self.run, 'stopRequested': True})
            value = self.stop_owned()
        summary = self.root / self.plan['artifacts']['supervisor']
        deadline = time.monotonic() + 20
        while value and not summary.exists() and time.monotonic() < deadline:
            time.sleep(0.2)
        value = self.inspect(allow_missing=True)
        if value and value['state'] not in INACTIVE:
            raise Refused('test-stop-unconfirmed')
        return {'runId': self.run, 'container': self.name, 'stopConfirmed': True, 'state': value['state'] if value else 'missing', 'supervisorSummaryAvailable': summary.exists()}

    def cleanup_fixture(self):
        value = self.inspect(allow_missing=True)
        if value and value['state'] not in INACTIVE:
            raise Refused('stop-required-before-fixture-cleanup')
        manifest = self.root / self.plan['manifestPath']
        if manifest.exists() or manifest.is_symlink():
            private_json(manifest, limit=2 * 1024 * 1024)
            manifest.unlink()
        return {'runId': self.run, 'container': self.name, 'privateFixtureRemoved': not manifest.exists()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'supervise', 'status', 'stop', 'cleanup-fixture'])
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--grace', type=int, default=0, choices=range(31))
    args = parser.parse_args()
    stand = Stand(load_plan(args.plan), args.plan)
    result = stand.stop(args.grace) if args.action == 'stop' else getattr(stand, args.action.replace('-', '_'))()
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, Refused) else 'remote-stand-failed'}, separators=(',', ':')))
        raise SystemExit(1)
