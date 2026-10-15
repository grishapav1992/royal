"""Safety regressions for the stand supervisor; no Docker, listeners or network."""
from contextlib import ExitStack, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / 'load-remote-stand.py'
SPEC = importlib.util.spec_from_file_location('load_remote_stand_tested', MODULE_PATH)
SUPERVISOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUPERVISOR)
RUNTIME = ('frozen-server.mjs', 'dist-load/cluster.mjs', 'dist-load/database.mjs',
           'dist-load/metrics.mjs', 'dist-load/metadata.json', 'runtime-check.mjs',
           'bin/caddy', 'bin/redis-server')
OWN_ID = 'a' * 64


def valid_plan(clients=100, seconds=60):
    run = 's8-unit-20261011'
    prefix = 'run/stage-' + str(clients)
    return {'protocol': 1, 'runId': run, 'ownedRoot': '/opt/royal-load-' + run,
            'containerName': 'royal-load-' + run + '-test',
            'stage': {'clients': clients, 'seconds': seconds, 'workers': 4, 'inputMode': 'browser-window'},
            'localPorts': {'api': 38001, 'control': 38002}, 'bundleSha256': 'b' * 64,
            'runtimeFiles': {name: 'b' * 64 for name in RUNTIME},
            'supervisor': {'path': 'load-remote-stand.py', 'sha256': 'c' * 64}, 'guardSha256': 'd' * 64,
            'manifestPath': prefix + '-private.json',
            'artifacts': {key: prefix + suffix for key, suffix in {
                'server': '-server.json', 'guard': '-guard.json',
                'guardSamples': '-guard.jsonl', 'supervisor': '-supervisor.json'}.items()},
            'production': {name: {'Id': char * 64, 'Image': 'sha256:' + char * 64,
                                  'StartedAt': '2026-10-11T11:12:57Z'}
                           for name, char in [('game', 'e'), ('caddy', 'f')]}}


def private_file(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    path.chmod(0o600)


class DockerFake:
    def __init__(self, plan, state='running'):
        self.plan, self.calls, self.stop_fault, self.replace_after_stop = plan, [], None, None
        self.value = {'Id': OWN_ID, 'Name': '/' + plan['containerName'],
                      'Image': plan['production']['game']['Image'], 'label': plan['runId'],
                      'state': state, 'exitCode': 0, 'oomKilled': False} if state else None

    def __call__(self, args, **kwargs):
        self.calls.append((list(args), kwargs))
        if args[:2] == ['docker', 'ps']:
            return self.value['Id'] if self.value else ''
        if args[:2] == ['docker', 'inspect']:
            if args[-1] in ('royal-game-1', 'royal-caddy-1'):
                service = args[-1].split('-')[1]
                return json.dumps({**self.plan['production'][service], 'Status': 'running'})
            if not self.value or args[-1] != self.value['Id']:
                raise AssertionError('Unexpected container inspection')
            return json.dumps(self.value)
        if args[:2] in (['docker', 'stop'], ['docker', 'kill']):
            if not self.value or args[-1] != self.value['Id'] or args[-1] in {
                    item['Id'] for item in self.plan['production'].values()}:
                raise AssertionError('Attempted unowned mutation')
            if args[1] == 'stop' and self.stop_fault:
                if self.replace_after_stop:
                    self.value.update(self.replace_after_stop)
                raise self.stop_fault
            self.value['state'] = 'exited'
            return args[-1]
        if args[:2] == ['docker', 'create']:
            self.value = {'Id': OWN_ID, 'Name': '/' + self.plan['containerName'],
                          'Image': self.plan['production']['game']['Image'], 'label': self.plan['runId'],
                          'state': 'created', 'exitCode': 0, 'oomKilled': False}
            return OWN_ID
        raise AssertionError('Unmocked system command: ' + repr(args[:2]))

    def mutations(self):
        return [args for args, _ in self.calls if args[:2] in (
            ['docker', 'create'], ['docker', 'start'], ['docker', 'stop'], ['docker', 'kill'])]


class PlanSafetyTests(unittest.TestCase):
    def test_supported_stage_limits(self):
        for count in (100, 250, 500, 1000, 1200):
            for seconds in (1, 1800):
                with self.subTest(count=count, seconds=seconds):
                    self.assertEqual(SUPERVISOR.validate(valid_plan(count, seconds))['stage']['clients'], count)

    def test_production_targets_and_traversal_are_rejected(self):
        cases = [({'ownedRoot': '/opt/royal'}), ({'containerName': 'royal-game-1'}),
                 ({'containerName': 'royal-caddy-1'}), ({'manifestPath': '../.env'}),
                 ({'runId': 's8-../../royal'}), ({'protocol': 2}), ({'protocol': '1'})]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(SUPERVISOR.Refused):
                SUPERVISOR.validate({**valid_plan(), **changes})
        for path in ('/opt/royal/.env', '../.env', 'run/../.env', 'run//private.json', 'run/./a', 'a\\b'):
            with self.subTest(path=path), self.assertRaises(SUPERVISOR.Refused):
                SUPERVISOR.relative(path)

    def test_workload_and_ports_fail_before_actions(self):
        for field, values in [('clients', (0, 99, 1001, 1201, True, '100')),
                              ('seconds', (0, 1801, True, '60')),
                              ('workers', (1, 5)), ('inputMode', ('stress', 'unknown'))]:
            for value in values:
                plan = valid_plan()
                plan['stage'][field] = value
                with self.subTest(field=field, value=value), self.assertRaises(SUPERVISOR.Refused):
                    SUPERVISOR.validate(plan)
        for ports in ({'api': 80, 'control': 38002}, {'api': 38001, 'control': 38001},
                      {'api': '38001', 'control': 38002}, {'api': True, 'control': 65536}):
            with self.subTest(ports=ports), self.assertRaises(SUPERVISOR.Refused):
                SUPERVISOR.validate({**valid_plan(), 'localPorts': ports})

    def test_integrity_set_is_mandatory_and_exact(self):
        changes = [{'runtimeFiles': {}}, {'guardSha256': 'broken'},
                   {'supervisor': {'path': '../load-remote-stand.py', 'sha256': 'c' * 64}},
                   {'runtimeFiles': {**valid_plan()['runtimeFiles'], '../.env': 'b' * 64}},
                   {'runtimeFiles': {**valid_plan()['runtimeFiles'], 'frozen-server.mjs': 'c' * 64}}]
        for changed in changes:
            with self.subTest(changed=list(changed)), self.assertRaises(SUPERVISOR.Refused):
                SUPERVISOR.validate({**valid_plan(), **changed})

    def test_private_json_refuses_public_symlink_and_oversized_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = root / 'plan.json'
            private_file(plan, valid_plan())
            self.assertEqual(SUPERVISOR.private_json(plan)['protocol'], 1)
            plan.chmod(0o644)
            with self.assertRaises(SUPERVISOR.Refused):
                SUPERVISOR.private_json(plan)
            plan.chmod(0o600)
            link = root / 'link.json'
            link.symlink_to(plan)
            with self.assertRaises(SUPERVISOR.Refused):
                SUPERVISOR.private_json(link)
            plan.write_text(' ' * 65537)
            with self.assertRaises(SUPERVISOR.Refused):
                SUPERVISOR.private_json(plan)

    def test_plan_outside_owned_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'stand-plan.json'
            private_file(file, valid_plan())
            with self.assertRaisesRegex(SUPERVISOR.Refused, 'plan-outside-owned-root'):
                SUPERVISOR.load_plan(file)

    def test_bounded_command_refuses_failure_without_exposing_secret_output(self):
        response = subprocess.CompletedProcess(['docker'], 1, b'DO-NOT-PRINT-STDOUT', b'DO-NOT-PRINT-STDERR')
        with patch.object(SUPERVISOR.subprocess, 'run', return_value=response) as run:
            with self.assertRaises(SUPERVISOR.Refused) as failed:
                SUPERVISOR.command(['docker', 'inspect', 'unit-id'], timeout=7)
            self.assertEqual(str(failed.exception), 'bounded-command-failed')
            self.assertEqual(set(run.call_args.kwargs['env']), {'PATH', 'HOME'})
            self.assertEqual(run.call_args.kwargs['timeout'], 7)
        response.returncode = 0
        with patch.object(SUPERVISOR.subprocess, 'run', return_value=response), self.assertRaises(SUPERVISOR.Refused):
            SUPERVISOR.command(['docker', 'inspect', 'unit-id'], limit=5)


class StandSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.plan = valid_plan()
        self.plan['ownedRoot'] = str(self.root)
        for name in ('run', 'runtime', 'postgres', 'home'):
            (self.root / name).mkdir()
        for name in RUNTIME:
            target = self.root / 'runtime' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            data = ('unit fixture ' + name).encode()
            target.write_bytes(data)
            self.plan['runtimeFiles'][name] = hashlib.sha256(data).hexdigest()
        self.plan['bundleSha256'] = self.plan['runtimeFiles']['frozen-server.mjs']
        self.stand = SUPERVISOR.Stand(self.plan, self.root / 'stand-plan.json')
        self.docker = DockerFake(self.plan)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(SUPERVISOR, 'command', side_effect=self.docker))
        self.stack.enter_context(patch.object(SUPERVISOR.subprocess, 'Popen', side_effect=AssertionError('Unmocked process')))
        self.stack.enter_context(patch.object(SUPERVISOR.urllib.request, 'build_opener', side_effect=AssertionError('Unmocked HTTP')))

    def pin(self, **values):
        private_file(self.stand.state_path, {'runId': self.plan['runId'], 'containerId': OWN_ID, **values})

    def fixture(self):
        data = {'runId': 'local-stand-unit', 'bundleSha256': self.plan['bundleSha256'],
                'clients': 100, 'seconds': 60, 'apiEndpoint': 'http://127.0.0.1:38001',
                'serverApiPort': 41001, 'serverControlPort': 41002,
                'controlNonce': 'DO-NOT-PRINT-NONCE', 'tokens': ['DO-NOT-PRINT-TOKEN'],
                'databasePassword': 'DO-NOT-PRINT-PASSWORD'}
        private_file(self.root / self.plan['manifestPath'], data)
        return data

    def test_foreign_label_never_stops_or_kills(self):
        self.docker.value['label'] = 'foreign-run'
        with self.assertRaisesRegex(SUPERVISOR.Refused, 'container-ownership-changed'):
            self.stand.stop_owned()
        self.assertEqual(self.docker.mutations(), [])

    def test_same_name_replacement_id_never_stops_or_kills(self):
        self.pin()
        self.docker.value['Id'] = '9' * 64
        with self.assertRaisesRegex(SUPERVISOR.Refused, 'container-id-changed'):
            self.stand.stop_owned()
        self.assertEqual(self.docker.mutations(), [])

    def test_stop_timeout_reinspects_before_exact_owned_kill(self):
        self.pin()
        self.docker.stop_fault = subprocess.TimeoutExpired(['docker', 'stop'], 12)
        result = self.stand.stop_owned()
        self.assertEqual(result['state'], 'exited')
        commands = [args for args, _ in self.docker.calls]
        self.assertEqual(self.docker.mutations(), [['docker', 'stop', '-t', '5', OWN_ID], ['docker', 'kill', OWN_ID]])
        stop = next(index for index, args in enumerate(commands) if args[:2] == ['docker', 'stop'])
        kill = next(index for index, args in enumerate(commands) if args[:2] == ['docker', 'kill'])
        self.assertTrue(any(args[:2] == ['docker', 'inspect'] for args in commands[stop + 1:kill]))
        self.assertEqual([kwargs['timeout'] for args, kwargs in self.docker.calls if args[:2] in
                          (['docker', 'stop'], ['docker', 'kill'])], [12, 10])

    def test_stop_failure_then_foreign_label_or_new_id_refuses_kill(self):
        for replacement in ({'label': 'foreign'}, {'Id': '8' * 64}):
            with self.subTest(replacement=replacement):
                self.docker = DockerFake(self.plan)
                self.docker.stop_fault = SUPERVISOR.Refused('bounded-command-failed')
                self.docker.replace_after_stop = replacement
                self.pin()
                with patch.object(SUPERVISOR, 'command', side_effect=self.docker), self.assertRaises(SUPERVISOR.Refused):
                    self.stand.stop_owned()
                self.assertEqual(self.docker.mutations(), [['docker', 'stop', '-t', '5', OWN_ID]])

    def test_inactive_or_missing_container_has_no_stop(self):
        for state in ('created', 'exited', 'dead', None):
            docker = DockerFake(self.plan, state)
            with self.subTest(state=state), patch.object(SUPERVISOR, 'command', side_effect=docker):
                self.stand.stop_owned()
                self.assertEqual(docker.mutations(), [])

    def test_fixture_cleanup_requires_inactive_and_preserves_other_files(self):
        self.fixture()
        unrelated = self.root / 'run/other-private.json'
        private_file(unrelated, {'token': 'UNRELATED'})
        with self.assertRaisesRegex(SUPERVISOR.Refused, 'stop-required-before-fixture-cleanup'):
            self.stand.cleanup_fixture()
        self.assertTrue((self.root / self.plan['manifestPath']).exists())
        self.docker.value['state'] = 'exited'
        self.assertTrue(self.stand.cleanup_fixture()['privateFixtureRemoved'])
        self.assertTrue(unrelated.exists())

    def test_fixture_cleanup_refuses_symlink_and_keeps_target(self):
        self.docker.value['state'] = 'exited'
        target = self.root / 'run/other-private.json'
        private_file(target, {'secret': 'UNRELATED'})
        manifest = self.root / self.plan['manifestPath']
        manifest.symlink_to(target)
        with self.assertRaises(SUPERVISOR.Refused):
            self.stand.cleanup_fixture()
        self.assertTrue(target.exists())
        self.assertTrue(manifest.is_symlink())

    def proc_reader(self, available=2048, busy=10, guard_state='S'):
        original = Path.read_text
        calls = {'cpu': 0}

        def read(path, *args, **kwargs):
            if str(path) == '/proc/meminfo':
                return 'MemAvailable: ' + str(available * 1024) + ' kB\n'
            if str(path) == '/proc/stat':
                calls['cpu'] += 1
                index = calls['cpu']
                return f'cpu {busy * index} 0 0 {(100 - busy) * index} 0 0 0 0\n'
            if str(path) == '/proc/123/stat':
                return '123 (python3) ' + ' '.join([guard_state] + ['0'] * 18 + ['456'])
            return original(path, *args, **kwargs)
        return read

    def test_insufficient_memory_and_cpu_prevent_create_and_start(self):
        for available, busy, reason in ((1395, 10, 'memory'), (2048, 70, 'cpu'), (2048, 100, 'cpu')):
            self.docker = DockerFake(self.plan, None)
            with self.subTest(available=available, busy=busy), \
                    patch.object(SUPERVISOR, 'command', side_effect=self.docker), \
                    patch.object(Path, 'read_text', self.proc_reader(available, busy)), \
                    patch.object(SUPERVISOR.time, 'sleep'), \
                    self.assertRaisesRegex(SUPERVISOR.Refused, 'insufficient-host-' + reason):
                self.stand.create()
            self.assertEqual(self.docker.mutations(), [])

    def test_tampered_runtime_asset_prevents_docker_create(self):
        self.docker = DockerFake(self.plan, None)
        target = self.root / 'runtime/bin/redis-server'
        target.write_bytes(b'tampered unit fixture')
        with patch.object(SUPERVISOR, 'command', side_effect=self.docker), \
                self.assertRaisesRegex(SUPERVISOR.Refused, 'prepared-runtime-digest-mismatch'):
            self.stand.create()
        self.assertEqual(self.docker.mutations(), [])

    def test_changed_guard_digest_or_public_root_refuses_plan_load(self):
        self.root.chmod(0o700)
        (self.root / 'owner').write_text(self.plan['runId'])
        for name, key in [('load-remote-stand.py', 'supervisor'), ('load-host-guard.py', 'guard')]:
            target = self.root / name
            target.write_bytes(b'unit helper ' + name.encode())
            value = hashlib.sha256(target.read_bytes()).hexdigest()
            if key == 'supervisor':
                self.plan['supervisor']['sha256'] = value
            else:
                self.plan['guardSha256'] = value
        private_file(self.stand.plan_path, self.plan)
        original = Path.stat

        def root_owned_stat(path, *args, **kwargs):
            values = list(original(path, *args, **kwargs))
            values[4] = 0
            return os.stat_result(values)

        # Target prefixes are tested above. Here only the filesystem is mapped
        # to a temporary directory and its UID is simulated, without root access.
        with patch.object(SUPERVISOR, 'validate', side_effect=lambda plan: plan), \
                patch.object(Path, 'stat', root_owned_stat):
            self.assertEqual(SUPERVISOR.load_plan(self.stand.plan_path)['runId'], self.plan['runId'])
            (self.root / 'load-host-guard.py').write_bytes(b'changed helper')
            with self.assertRaisesRegex(SUPERVISOR.Refused, 'supervisor-or-guard-digest-mismatch'):
                SUPERVISOR.load_plan(self.stand.plan_path)
            self.root.chmod(0o755)
            with self.assertRaisesRegex(SUPERVISOR.Refused, 'private-owned-root-required'):
                SUPERVISOR.load_plan(self.stand.plan_path)

    def test_status_stdout_does_not_expose_tokens_nonce_or_credentials(self):
        self.pin(phase='running', guardPid=123, guardStartTicks='456')
        self.fixture()
        output = io.StringIO()
        with patch.object(Path, 'read_text', self.proc_reader()), \
                patch.object(SUPERVISOR, 'load_plan', return_value=self.plan), \
                patch('sys.argv', ['load-remote-stand.py', 'status', '--plan', str(self.stand.plan_path)]), \
                redirect_stdout(output):
            SUPERVISOR.main()
        status = json.loads(output.getvalue())
        self.assertTrue(status['ready'])
        self.assertTrue(status['guardActive'])
        self.assertEqual(status['serverApiPort'], 41001)
        self.assertEqual(status['serverControlPort'], 41002)
        for secret in ('DO-NOT-PRINT', 'tokens', 'controlNonce', 'databasePassword'):
            self.assertNotIn(secret, output.getvalue())

    def test_status_accepts_1000_token_manifest_over_64k_without_relaxing_plan_limit(self):
        self.plan['stage']['clients'] = 1000
        self.plan['manifestPath'] = 'run/stage-1000-private.json'
        self.stand = SUPERVISOR.Stand(self.plan, self.stand.plan_path)
        self.pin(phase='running', guardPid=123, guardStartTicks='456')
        data = self.fixture()
        data['clients'] = 1000
        data['tokens'] = ['DO-NOT-PRINT-TOKEN-' + str(index) + '-' + 't' * 96 for index in range(1000)]
        manifest = self.root / self.plan['manifestPath']
        private_file(manifest, data)
        self.assertGreater(manifest.stat().st_size, 65536)
        self.assertLess(manifest.stat().st_size, 2 * 1024 * 1024)
        with self.assertRaisesRegex(SUPERVISOR.Refused, 'private-plan-required'):
            SUPERVISOR.private_json(manifest)
        with patch.object(Path, 'read_text', self.proc_reader()):
            status = self.stand.status()
        self.assertTrue(status['ready'])
        self.assertTrue(status['guardActive'])
        self.assertNotIn('DO-NOT-PRINT', json.dumps(status))

    def test_zombie_or_dead_guard_and_failed_supervisor_never_attest_ready(self):
        self.fixture()
        for guard_state, phase in [('Z', 'running'), ('X', 'running'), ('x', 'running'), ('S', 'failed')]:
            self.pin(phase=phase, guardPid=123, guardStartTicks='456')
            with self.subTest(guard_state=guard_state, phase=phase), \
                    patch.object(Path, 'read_text', self.proc_reader(guard_state=guard_state)):
                status = self.stand.status()
            self.assertFalse(status['ready'])
            if guard_state != 'S':
                self.assertFalse(status['guardActive'])
            self.assertNotIn('serverApiPort', status)

    def test_start_log_open_or_popen_failure_cleans_created_container_and_restores_handlers(self):
        original_open = Path.open
        handlers = {SUPERVISOR.signal.SIGTERM: object(), SUPERVISOR.signal.SIGINT: object()}
        for fault in ('log-open', 'popen'):
            self.stand.state_path.unlink(missing_ok=True)
            (self.root / 'run/supervisor.log').unlink(missing_ok=True)
            docker = DockerFake(self.plan, None)

            def open_file(path, mode='r', *args, **kwargs):
                if fault == 'log-open' and path == self.root / 'run/supervisor.log' and mode == 'x':
                    raise OSError('unit supervisor log failure')
                return original_open(path, mode, *args, **kwargs)

            with self.subTest(fault=fault), ExitStack() as stack:
                stack.enter_context(patch.object(SUPERVISOR, 'command', side_effect=docker))
                stack.enter_context(patch.object(self.stand, 'host_gate'))
                stack.enter_context(patch.object(Path, 'open', open_file))
                stack.enter_context(patch.object(SUPERVISOR.signal, 'getsignal', side_effect=handlers.__getitem__))
                signals = stack.enter_context(patch.object(SUPERVISOR.signal, 'signal'))
                popen = stack.enter_context(patch.object(SUPERVISOR.subprocess, 'Popen', side_effect=OSError('unit spawn failure')))
                stopped = stack.enter_context(patch.object(self.stand, 'stop_owned', wraps=self.stand.stop_owned))
                with self.assertRaises(OSError):
                    self.stand.start()
                stopped.assert_called_once_with()
                self.assertEqual(popen.call_count, 1 if fault == 'popen' else 0)
                self.assertEqual([item.args for item in signals.call_args_list[-2:]], list(handlers.items()))
            self.assertEqual(docker.value['state'], 'created')
            self.assertEqual(len(docker.mutations()), 1)
            self.assertEqual(docker.mutations()[0][:2], ['docker', 'create'])

    def test_sigterm_during_docker_create_cleans_owned_container_and_restores_handlers(self):
        docker = DockerFake(self.plan, None)
        prior = {SUPERVISOR.signal.SIGTERM: object(), SUPERVISOR.signal.SIGINT: object()}
        installed = {}

        def signal_handler(number, handler):
            installed[number] = handler

        def interrupted_command(args, **kwargs):
            result = docker(args, **kwargs)
            if args[:2] == ['docker', 'create']:
                # Docker accepted the create before the caller was interrupted.
                # Invoke only the mocked callback, never send an OS signal.
                installed[SUPERVISOR.signal.SIGTERM](SUPERVISOR.signal.SIGTERM, None)
            return result

        with ExitStack() as stack:
            stack.enter_context(patch.object(SUPERVISOR, 'command', side_effect=interrupted_command))
            stack.enter_context(patch.object(self.stand, 'host_gate'))
            stack.enter_context(patch.object(SUPERVISOR.signal, 'getsignal', side_effect=prior.__getitem__))
            signals = stack.enter_context(patch.object(SUPERVISOR.signal, 'signal', side_effect=signal_handler))
            popen = stack.enter_context(patch.object(SUPERVISOR.subprocess, 'Popen'))
            stopped = stack.enter_context(patch.object(self.stand, 'stop_owned', wraps=self.stand.stop_owned))
            with self.assertRaises(KeyboardInterrupt):
                self.stand.start()
            self.assertGreaterEqual(stopped.call_count, 1)
            popen.assert_not_called()
            self.assertEqual([item.args for item in signals.call_args_list[-2:]], list(prior.items()))
        self.assertEqual(docker.value['Id'], OWN_ID)
        self.assertIn(docker.value['state'], SUPERVISOR.INACTIVE)
        self.assertEqual(len(docker.mutations()), 1)
        self.assertEqual(docker.mutations()[0][:2], ['docker', 'create'])

    def test_stop_of_created_container_prevents_create_start_and_delayed_supervisor_start(self):
        self.docker.value['state'] = 'created'
        # Advance only the mocked clock to bypass the optional summary wait.
        with patch.object(SUPERVISOR.time, 'monotonic', side_effect=iter(range(0, 1000, 100))):
            stopped = self.stand.stop(0)
        self.assertTrue(stopped['stopConfirmed'])
        marker = self.root / 'stop-requested.json'
        self.assertTrue(SUPERVISOR.private_json(marker)['stopRequested'])
        with self.assertRaisesRegex(SUPERVISOR.Refused, 'stop-requested-before-start'):
            self.stand.create()
        with patch.object(SUPERVISOR.signal, 'getsignal', return_value=SUPERVISOR.signal.SIG_DFL), \
                patch.object(SUPERVISOR.signal, 'signal'), \
                patch.object(SUPERVISOR.subprocess, 'Popen') as detached, \
                self.assertRaisesRegex(SUPERVISOR.Refused, 'stop-requested-before-start'):
            self.stand.start()
        detached.assert_not_called()

        class FakeGuard:
            terminated = False

            def poll(self):
                return 0 if self.terminated else None

            def terminate(self):
                self.terminated = True

            def wait(self, timeout):
                return 0

        guard = FakeGuard()
        with patch.object(SUPERVISOR.signal, 'signal'), patch.object(SUPERVISOR.time, 'sleep'), \
                patch.object(SUPERVISOR.subprocess, 'Popen', return_value=guard):
            result = self.stand.supervise()
        self.assertFalse(result['started'])
        self.assertFalse(result['passed'])
        self.assertEqual(result['reason'], 'stop-requested-before-start')
        self.assertTrue(result['stopConfirmed'])
        self.assertTrue(guard.terminated)
        self.assertEqual(self.docker.mutations(), [])
        self.assertFalse(any(args[:2] == ['docker', 'start'] for args, _ in self.docker.calls))

    def test_cancellation_during_host_gate_prevents_docker_create(self):
        docker = DockerFake(self.plan, None)

        def cancel_during_gate():
            SUPERVISOR.write_private(self.root / 'stop-requested.json',
                                     {'runId': self.plan['runId'], 'stopRequested': True})

        with patch.object(SUPERVISOR, 'command', side_effect=docker), \
                patch.object(self.stand, 'host_gate', side_effect=cancel_during_gate) as gate, \
                self.assertRaisesRegex(SUPERVISOR.Refused, 'stop-requested-before-start'):
            self.stand.create()
        gate.assert_called_once_with()
        self.assertEqual(docker.mutations(), [])
        self.assertIsNone(docker.value)
        self.assertFalse(self.stand.state_path.exists())

    def test_reused_guard_pid_does_not_attest_ready(self):
        self.pin(phase='running', guardPid=123, guardStartTicks='999')
        self.fixture()
        with patch.object(Path, 'read_text', self.proc_reader()):
            result = self.stand.status()
        self.assertFalse(result['guardActive'])
        self.assertFalse(result['ready'])

    def test_manifest_wrong_origin_or_bundle_refuses_ready(self):
        self.pin(phase='running', guardPid=123, guardStartTicks='456')
        for key, value in [('apiEndpoint', 'https://production.invalid'), ('bundleSha256', '0' * 64)]:
            data = self.fixture()
            data[key] = value
            private_file(self.root / self.plan['manifestPath'], data)
            with self.subTest(key=key), patch.object(Path, 'read_text', self.proc_reader()), \
                    self.assertRaisesRegex(SUPERVISOR.Refused, 'manifest-attestation-failed'):
                self.stand.status()

    def test_production_image_or_start_change_blocks_anchors(self):
        for key, value in [('Image', 'sha256:' + '0' * 64), ('StartedAt', 'later-release')]:
            def inspect(args, **kwargs):
                data = dict(self.plan['production']['game'], Status='running')
                data[key] = value
                return json.dumps(data)
            with self.subTest(key=key), patch.object(SUPERVISOR, 'command', side_effect=inspect), \
                    self.assertRaisesRegex(SUPERVISOR.Refused, 'production-anchor-changed'):
                self.stand.anchors()


if __name__ == '__main__':
    unittest.main()
