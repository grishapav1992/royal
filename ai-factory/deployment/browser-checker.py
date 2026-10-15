#!/usr/bin/env python3
"""Run only fixed, credential-free Royal browser checks in separate containers."""
from pathlib import Path
from datetime import datetime, timezone
import fcntl
import json
import os
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

QUEUE = Path('/opt/royal-ai-browser-queue')
INSTALL = Path('/opt/royal-ai-browser-checker')
CONFIG = Path('/etc/royal-ai-browser-checker.json')
VOLUME = 'royal-ai_factory_workspaces'
DOCKER = '/usr/bin/docker'
UUID = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\Z')
TEST = re.compile(r'tests/[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.spec\.ts\Z')
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}\Z')
FIELDS = {'request_id', 'task_id', 'candidate_commit', 'requirements_version', 'tests'}
DEADLINE = 600
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}
stopping = False


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def canonical(path, directory=True, root_owned=False):
    info = path.lstat()
    if path.is_symlink() or path.resolve(strict=True) != path or (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode)):
        raise ValueError('Noncanonical checker path')
    if root_owned and (info.st_uid != 0 or info.st_mode & 0o022):
        raise ValueError('Checker configuration must be owned and writable only by root')
    return info


def bounded_read(path, limit, root_owned=False):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise ValueError('Checker input must be a bounded regular file without links')
        if root_owned and (info.st_uid != 0 or info.st_mode & 0o022):
            raise ValueError('Checker configuration must be private to root')
        content = os.read(descriptor, limit + 1)
        after = os.fstat(descriptor)
        if len(content) > limit or len(content) != info.st_size or (info.st_size, info.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('Checker input changed while reading')
        return content, info
    finally:
        os.close(descriptor)


def validate_request(value, request_id):
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise ValueError('Invalid browser request fields')
    if value['request_id'] != request_id or not isinstance(value['request_id'], str) or not UUID.fullmatch(value['request_id']):
        raise ValueError('Invalid request identity')
    if not isinstance(value['task_id'], str) or not UUID.fullmatch(value['task_id']):
        raise ValueError('Invalid task identity')
    if not isinstance(value['candidate_commit'], str) or not COMMIT.fullmatch(value['candidate_commit']):
        raise ValueError('Invalid candidate commit')
    if type(value['requirements_version']) is not int or not 1 <= value['requirements_version'] <= 9007199254740991:
        raise ValueError('Invalid requirements version')
    tests = value['tests']
    if not isinstance(tests, list) or not 1 <= len(tests) <= 8 or any(not isinstance(name, str) or not TEST.fullmatch(name) for name in tests) or len(set(tests)) != len(tests):
        raise ValueError('Invalid canonical browser test list')
    return value


def load_request(path, request_id):
    content, info = bounded_read(path, 4096)
    age = time.time() - info.st_mtime
    if age > 120 or age < -5:
        raise ValueError('Browser request expired before execution')
    return validate_request(json.loads(content), request_id)


def atomic_response(path, value):
    # The queue itself is root-owned. Replacing a destination never follows its symlink.
    temporary = path.parent / ('.response-' + str(uuid.uuid4()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640)
    try:
        value = dict(value)
        content = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8', errors='replace')
        # Control characters and Unicode have different encoded sizes. Bound the final JSON.
        while len(content) > 65536 and isinstance(value.get('detail'), str) and value['detail']:
            value['detail'] = value['detail'][len(value['detail']) // 2:]
            content = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8', errors='replace')
        if len(content) > 65536:
            raise ValueError('Browser response exceeded its bound')
        with os.fdopen(descriptor, 'wb') as handle:
            descriptor = None
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def docker(arguments, timeout=15):
    return subprocess.run([DOCKER, *arguments], env=ENV, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=True)


def workspace_root():
    value = json.loads(docker(['volume', 'inspect', VOLUME]).stdout)
    if len(value) != 1 or value[0].get('Name') != VOLUME or value[0].get('Driver') != 'local' or value[0].get('Options'):
        raise ValueError('Only the existing local factory workspace volume is accepted')
    path = Path(value[0]['Mountpoint'])
    canonical(path)
    return path


def validate_workspace(root, request):
    path = root / request['task_id']
    canonical(path)
    for name in ['.git', '.factory', '.codex', '.agents', '.aws', 'tests']:
        canonical(path / name)
    for name in request['tests']:
        info = canonical(path / name, directory=False)
        if info.st_nlink != 1:
            raise ValueError('Selected browser tests must not have additional links')
    return path


def cancelled(request_id, request_path):
    if stopping or not request_path.exists():
        return True
    path = QUEUE / (request_id + '.cancel')
    try:
        content, _ = bounded_read(path, 64)
        return True
    except FileNotFoundError:
        return False


def remove_container(name):
    try:
        docker(['rm', '-f', name], timeout=10)
    except (subprocess.SubprocessError, OSError):
        pass


def queued_requests():
    requests = []
    cleaned = 0
    cutoff = time.time() - 3600
    # Count only requests toward the execution bound; old responses cannot starve new work.
    with os.scandir(QUEUE) as entries:
        for entry in entries:
            suffix = next((ending for ending in ['.request.json', '.response.json', '.cancel'] if entry.name.endswith(ending)), None)
            if suffix is None or not UUID.fullmatch(entry.name[:-len(suffix)]):
                continue
            if suffix == '.request.json':
                if len(requests) < 1024:
                    requests.append(QUEUE / entry.name)
            elif cleaned < 100:
                try:
                    info = entry.stat(follow_symlinks=False)
                    active = QUEUE / (entry.name[:-len(suffix)] + '.request.json')
                    if stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_mtime < cutoff and not active.exists():
                        (QUEUE / entry.name).unlink(missing_ok=True)
                        cleaned += 1
                except FileNotFoundError:
                    pass
    return sorted(requests, key=lambda path: path.name)


def container_args(image, path, request, name):
    inside = '/workspaces/' + request['task_id']
    args = ['run', '--rm', '--name', name, '--label', 'royal-ai-browser-checker=1',
            '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--security-opt', 'apparmor=docker-default',
            '--init', '--read-only', '--memory', '1536m', '--memory-swap', '1536m',
            '--cpus', '1', '--pids-limit', '256',
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
            '--shm-size', '64m', '--workdir', inside,
            '--mount', f'type=bind,src={path},dst={inside}',
            '--mount', f'type=bind,src={INSTALL / "browser-check.mjs"},dst=/royal-check/browser-check.mjs,readonly',
            '--env', 'NODE_ENV=test', '--env', 'HOME=/tmp/royal-browser-home', '--env', 'CODEX_HOME=',
            '--env', 'CODEX_SALE_API_KEY=', '--env', 'OPENAI_API_KEY=', '--entrypoint', '/usr/local/bin/node']
    for directory in ['.git', '.factory', '.codex', '.agents', '.aws']:
        args += ['--mount', f'type=bind,src={path / directory},dst={inside}/{directory},readonly']
    args += [image, '/royal-check/browser-check.mjs', json.dumps(request, separators=(',', ':'))]
    return args


def run_request(image, root, request_path, request):
    started = now()
    response = {**request, 'status': 'error', 'passed': False, 'exit_code': None,
                'started_at': started, 'finished_at': None, 'detail': 'Browser check did not finish.'}
    name = 'royal-ai-browser-check-' + request['request_id']
    child = None
    try:
        path = validate_workspace(root, request)
        if cancelled(request['request_id'], request_path):
            response.update(status='cancelled', detail='Browser check cancelled before execution.')
            return response
        args = container_args(image, path, request, name)
        # Container output is bounded on disk and checked while the process runs.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            child = subprocess.Popen([DOCKER, *args], env=ENV, stdin=subprocess.DEVNULL, stdout=output, stderr=errors)
            deadline = time.monotonic() + DEADLINE
            while child.poll() is None:
                if cancelled(request['request_id'], request_path):
                    response.update(status='cancelled', detail='Browser check cancelled.')
                    remove_container(name)
                    child.wait(timeout=10)
                    return response
                if time.monotonic() >= deadline:
                    response.update(status='timeout', detail='Browser check exceeded the fixed 600-second deadline.')
                    remove_container(name)
                    child.wait(timeout=10)
                    return response
                if os.fstat(output.fileno()).st_size > 65536 or os.fstat(errors.fileno()).st_size > 32768:
                    raise ValueError('Browser checker output exceeded its bound')
                time.sleep(0.5)
            output.seek(0)
            raw = output.read(65537)
            errors.seek(0)
            stderr = errors.read(32769)
            if len(raw) > 65536 or len(stderr) > 32768:
                raise ValueError('Browser checker output exceeded its bound')
            try:
                measured = json.loads(raw)
            except (ValueError, UnicodeError):
                raise ValueError('The fixed browser harness did not return a valid measured result') from None
            if not isinstance(measured, dict) or measured.get('request_id') != request['request_id'] or measured.get('candidate_commit') != request['candidate_commit']:
                raise ValueError('Browser result did not match the requested candidate')
            if measured.get('status') not in {'completed', 'error'} or type(measured.get('passed')) is not bool or not isinstance(measured.get('detail'), str):
                raise ValueError('Invalid browser result status')
            exit_code = measured.get('exit_code')
            if exit_code is not None and (type(exit_code) is not int or not 0 <= exit_code <= 255):
                raise ValueError('Invalid measured browser exit code')
            completed = measured['status'] == 'completed' and measured.get('started_tests') is True
            passed = completed and measured['passed'] is True and exit_code == 0 and child.returncode == 0 and re.fullmatch(r'[a-f0-9]{64}', measured.get('fingerprint', '')) is not None
            if completed and ((measured['passed'] is True) != passed or (exit_code == 0) != passed):
                raise ValueError('Browser process status did not match the measured result')
            response.update(status='completed' if completed else 'error', passed=passed, exit_code=exit_code,
                            detail=measured['detail'].replace('\u2014', '-')[-16000:])
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        response.update(status='error', passed=False, detail=str(error).replace('\u2014', '-')[:2000])
    finally:
        if child is not None and child.poll() is None:
            remove_container(name)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        remove_container(name)
        response['finished_at'] = now()
    return response


def self_test():
    identity = str(uuid.uuid4())
    request = {'request_id': identity, 'task_id': str(uuid.uuid4()), 'candidate_commit': 'a' * 40,
               'requirements_version': 1, 'tests': ['tests/demo-wallet.spec.ts']}
    validate_request(request, identity)
    invalid = [dict(request, command='touch /root/unsafe'), dict(request, task_id='../royal'),
               dict(request, candidate_commit='HEAD'), dict(request, requirements_version=True),
               dict(request, tests=['/tmp/a.spec.ts']), dict(request, tests=['tests/../../a.spec.ts']),
               dict(request, tests=['tests/a.spec.ts;id']), dict(request, tests=['tests/a.spec.ts'] * 2),
               dict(request, tests=['tests/a.spec.ts'] * 9), dict(request, image='untrusted')]
    for value in invalid:
        try:
            validate_request(value, identity)
        except ValueError:
            continue
        raise AssertionError('An unsafe request was accepted')
    with tempfile.TemporaryDirectory(prefix='royal-browser-checker-test-') as temporary:
        directory = Path(temporary).resolve()
        path = directory / (identity + '.request.json')
        path.write_text(json.dumps(request))
        load_request(path, identity)
        path.unlink()
        target = directory / 'target'
        target.write_text(json.dumps(request))
        path.symlink_to(target)
        try:
            load_request(path, identity)
        except OSError:
            pass
        else:
            raise AssertionError('A symlinked request was accepted')
        path.unlink()
        os.link(target, path)
        try:
            load_request(path, identity)
        except ValueError:
            pass
        else:
            raise AssertionError('A hardlinked request was accepted')
        path.unlink()
        path.write_text(json.dumps(request))
        os.utime(path, (time.time() - 121, time.time() - 121))
        try:
            load_request(path, identity)
        except ValueError:
            pass
        else:
            raise AssertionError('An expired request was accepted')
        path.unlink()
        os.mkfifo(path)
        try:
            load_request(path, identity)
        except ValueError:
            pass
        else:
            raise AssertionError('A FIFO request was accepted')
        path.unlink()
        path.write_text('x' * 4097)
        try:
            load_request(path, identity)
        except ValueError:
            pass
        else:
            raise AssertionError('An oversized request was accepted')
        args = container_args('sha256:' + 'b' * 64, directory / request['task_id'], request, 'royal-ai-browser-check-' + identity)
        assert '--network' in args and args[args.index('--network') + 1] == 'none'
        assert '--init' in args and '--read-only' in args and '--privileged' not in args
        assert not any('/var/run/docker.sock' in arg or '/home/node/.codex' in arg or 'factory_data' in arg for arg in args)
        assert sum('readonly' in arg for arg in args) == 6
        response = directory / (identity + '.response.json')
        atomic_response(response, {**request, 'detail': 'Тестирование ' * 16000, 'status': 'error'})
        assert response.stat().st_size <= 65536
        assert json.loads(response.read_text())['request_id'] == identity
        atomic_response(response, {**request, 'detail': '\x00' * 16000, 'status': 'error'})
        assert response.stat().st_size <= 65536
        atomic_response(response, {**request, 'detail': '\ud800', 'status': 'error'})
        assert json.loads(response.read_text())['detail'] == '?'
        foreign = directory / 'foreign-response-target'
        foreign.write_text('outside unchanged')
        response.unlink()
        response.symlink_to(foreign)
        atomic_response(response, {**request, 'detail': 'measured', 'status': 'completed'})
        assert not response.is_symlink() and foreign.read_text() == 'outside unchanged'
    print(json.dumps({'passed': True, 'checks': 'request validation, symlink/hardlink/FIFO/size/age rejection, fixed Docker isolation arguments, bounded Unicode responses and safe atomic replacement'}))


def main():
    global stopping
    if os.geteuid() != 0:
        raise ValueError('The browser checker must run on the Docker host')
    canonical(INSTALL, root_owned=True)
    canonical(INSTALL / 'browser-check.mjs', directory=False, root_owned=True)
    info = canonical(QUEUE)
    if info.st_uid != 0 or info.st_gid != 1000 or info.st_mode & 0o007 or not info.st_mode & stat.S_ISGID:
        raise ValueError('The private browser queue must be root:1000 with setgid and no other access')
    content, _ = bounded_read(CONFIG, 4096, root_owned=True)
    config = json.loads(content)
    if not isinstance(config, dict) or set(config) != {'image_id'} or not isinstance(config['image_id'], str) or not IMAGE.fullmatch(config['image_id']):
        raise ValueError('A fixed Docker image ID is required')
    image = config['image_id']
    if docker(['image', 'inspect', image, '--format', '{{.Id}}']).stdout.decode().strip() != image:
        raise ValueError('Pinned browser image is unavailable')
    root = workspace_root()
    lock_path = Path('/run/royal-ai-browser-checker/lock')
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        def stop(_signum, _frame):
            global stopping
            stopping = True
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        # Clean only containers labelled and named by this dedicated checker after a crash.
        for name in docker(['ps', '-a', '--filter', 'label=royal-ai-browser-checker=1', '--format', '{{.Names}}']).stdout.decode().splitlines():
            if name.startswith('royal-ai-browser-check-') and UUID.fullmatch(name[len('royal-ai-browser-check-'):]):
                remove_container(name)
        while not stopping:
            entries = queued_requests()
            for path in entries:
                suffix = '.request.json'
                if not path.name.endswith(suffix) or not UUID.fullmatch(path.name[:-len(suffix)]):
                    continue
                identity = path.name[:-len(suffix)]
                response_path = QUEUE / (identity + '.response.json')
                if response_path.exists() or response_path.is_symlink():
                    continue
                try:
                    request = load_request(path, identity)
                    result = run_request(image, root, path, request)
                except (ValueError, OSError) as error:
                    result = {'request_id': identity, 'task_id': None, 'candidate_commit': None,
                              'requirements_version': None, 'tests': [], 'status': 'error', 'passed': False,
                              'exit_code': None, 'detail': str(error)[:1000], 'started_at': now(), 'finished_at': now()}
                atomic_response(response_path, result)
                # A consumed request must not run again when the client removes its response.
                path.unlink(missing_ok=True)
                (QUEUE / (identity + '.cancel')).unlink(missing_ok=True)
                print(json.dumps({'request_id': identity, 'status': result['status'], 'passed': result['passed']}), flush=True)
                if stopping:
                    break
            time.sleep(0.5)


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    elif sys.argv[1:]:
        raise SystemExit('Unsupported checker arguments')
    else:
        main()
