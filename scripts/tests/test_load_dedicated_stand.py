"""Dedicated stand safety checks using fake Docker and local private files."""
from contextlib import ExitStack
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'load-dedicated-stand.py'
SPEC = importlib.util.spec_from_file_location('dedicated_stand_tested', SOURCE)
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)
RUN = 'e67dc241-1a2e-4b3f-91d0-037b901c929e'
ID = 'a' * 64
METADATA, BUNDLE = b'{"protocol":1}', b'compiled test bundle'


def plan():
    return HELPER.validate({'protocol': 1, 'targetHost': HELPER.HOST, 'runId': RUN,
        'ownedRoot': '/opt/royal-load-' + RUN, 'containerName': 'royal-load-' + RUN + '-test',
        'imageId': 'sha256:' + 'b' * 64, 'metadataSha256': hashlib.sha256(METADATA).hexdigest(),
        'bundleSha256': hashlib.sha256(BUNDLE).hexdigest(), 'machineIdSha256': 'c' * 64,
        'helperSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'clients': 1000, 'seconds': 60,
        'gameProcesses': 4})


class FakeDocker:
    def __init__(self, plan):
        self.plan, self.view, self.calls, self.stop_error, self.replacement = plan, None, [], None, None
        self.start_hook = None
        self.other_stands = []

    def created(self, status='created'):
        self.view = {'Id': ID, 'Name': '/' + self.plan['containerName'], 'Image': self.plan['imageId'],
                     'label': RUN, 'status': status, 'exitCode': 0, 'oomKilled': False}

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if args[:2] == ['docker', 'ps']:
            if 'label=' + HELPER.PURPOSE in args:
                return '\n'.join(identifier + ' ' + status for identifier, status in self.other_stands)
            return self.view['Id'] if self.view else ''
        if args[:3] == ['docker', 'image', 'inspect']:
            return json.dumps({'Id': self.plan['imageId'], 'Os': 'linux'})
        if args[:2] == ['docker', 'inspect']:
            if not self.view or args[-1] != ID:
                raise HELPER.Refused('bounded-command-failed')
            return json.dumps(self.view)
        if args[:2] == ['docker', 'create']:
            self.created()
            return ID
        if args[:2] == ['docker', 'start']:
            if args[-1] != ID:
                raise AssertionError('Unowned Docker start')
            self.view['status'] = 'exited'
            if self.start_hook:
                self.start_hook()
            return ID
        if args[:2] == ['docker', 'cp']:
            source, target = args[-2:]
            if source == ID + ':/app/dist-load/metadata.json':
                Path(target).write_bytes(METADATA)
            elif source == ID + ':/app/dist-server/index.js':
                Path(target).write_bytes(BUNDLE)
            else:
                raise AssertionError('Unapproved Docker copy')
            return ''
        if args[:2] in (['docker', 'stop'], ['docker', 'kill']):
            if args[-1] != ID:
                raise AssertionError('Unowned Docker mutation')
            if args[1] == 'stop' and self.stop_error:
                if self.replacement:
                    self.view.update(self.replacement)
                raise self.stop_error
            self.view['status'] = 'exited'
            return ID
        raise AssertionError('Unmocked system command')

    def mutations(self):
        return [args for args, _ in self.calls if args[:2] in
                (['docker', 'create'], ['docker', 'start'], ['docker', 'stop'], ['docker', 'kill'])]


class DedicatedStandTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'run').mkdir(mode=0o700)
        self.plan = plan()
        self.plan['ownedRoot'] = str(self.root)
        self.stand = HELPER.Stand(self.plan, self.root / 'plan.json')
        self.docker = FakeDocker(self.plan)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(HELPER, 'command', side_effect=self.docker))
        self.stack.enter_context(patch.object(HELPER.subprocess, 'Popen', side_effect=AssertionError('Unmocked process')))
        self.stack.enter_context(patch.object(HELPER, 'HOST_LOCK', self.root / 'host-admission.lock'))
        original = os.fstat

        def owned_fstat(descriptor):
            result = list(original(descriptor))
            result[4] = 0
            return os.stat_result(result)
        self.stack.enter_context(patch.object(HELPER.os, 'fstat', side_effect=owned_fstat))

    def state(self, **data):
        HELPER.write_private(self.stand.state_path, {'runId': RUN, 'containerId': ID, **data})

    def fixture(self):
        HELPER.write_private(self.stand.manifest, {'protocol': 1, 'role': 'isolated-test-stand', 'runId': RUN,
            'apiEndpoint': HELPER.CLIENT_ORIGIN, 'bundleSha256': self.plan['bundleSha256'], 'clients': 1000,
            'gameProcesses': 4, 'seconds': 60, 'serverApiPort': 38001, 'serverControlPort': 38002,
            'tokens': ['PRIVATE-TOKEN'] * 1000, 'secret': 'PRIVATE-CONTROL-SECRET'})

    def test_validate_exact_dedicated_host_uuid_immutable_image_and_capacity(self):
        invalid = [{'targetHost': '45.192.12.242'}, {'ownedRoot': '/opt/royal'}, {'containerName': 'royal-game-1'},
                   {'runId': '../royal'}, {'imageId': 'royal:latest'}, {'protocol': True}, {'clients': 1201},
                   {'clients': 6001, 'gameProcesses': 24}, {'gameProcesses': 25}, {'seconds': 1801},
                   {'metadataSha256': 'bad'}, {'gameProcesses': True}, {'clients': True}]
        for change in invalid:
            with self.subTest(change=change), self.assertRaises(HELPER.Refused):
                HELPER.validate({**plan(), **change})
        for processes, clients in [(1, 300), (4, 1200), (20, 6000), (24, 6000)]:
            with self.subTest(processes=processes):
                self.assertEqual(HELPER.validate({**plan(), 'gameProcesses': processes, 'clients': clients})['clients'], clients)

    def test_same_host_generators_require_explicit_loopback_profile(self):
        valid = {**plan(), 'sameHostGenerators': True}
        self.assertTrue(HELPER.validate(valid)['sameHostGenerators'])
        for value in [False, None, 1, 'true', {}]:
            with self.subTest(value=value), self.assertRaises(HELPER.Refused):
                HELPER.validate({**plan(), 'sameHostGenerators': value})
        with self.assertRaises(HELPER.Refused):
            HELPER.validate({**valid, 'tlsGateway': HELPER.TLS_GATEWAY})

    def test_same_host_generator_completion_uses_only_fixed_owned_path(self):
        self.plan['sameHostGenerators'] = True
        with patch.object(self.stand, 'host_gate'):
            self.stand.create()
        created = self.docker.mutations()[0]
        flag = created.index('--generator-completion-file')
        self.assertEqual(created[flag + 1], '/app/run/generator-completion.json')
        self.assertEqual(created.count('--generator-completion-file'), 1)
        self.assertNotIn('--generator-completion-file', self.docker.calls[0][0])

    def test_resource_caps_cannot_exceed_reserved_host_budget(self):
        for key, value in [('cpus', 18.1), ('cpus', True), ('memoryMiB', 40961), ('pidsLimit', 2049)]:
            budget = {**plan()['budget'], key: value}
            with self.subTest(key=key), self.assertRaises(HELPER.Refused):
                HELPER.validate({**plan(), 'budget': budget})

    def test_load_plan_accepts_only_pinned_raw_machine_identity(self):
        machine = b'dedicated-machine-unit\n'
        self.plan['machineIdSha256'] = hashlib.sha256(machine).hexdigest()
        HELPER.write_private(self.stand.plan_path, self.plan)
        original_stat, original_read = Path.stat, Path.read_bytes

        def owned_stat(path, *args, **kwargs):
            result = list(original_stat(path, *args, **kwargs))
            result[4] = 1000 if path == self.root / 'run' else 0
            return os.stat_result(result)

        def read(path):
            return machine if str(path) == '/etc/machine-id' else original_read(path)

        # Production-target validation is tested separately; map only its
        # filesystem target and UIDs to this test's temporary directory.
        with patch.object(HELPER, 'validate', side_effect=lambda value: value), \
                patch.object(Path, 'stat', owned_stat), patch.object(Path, 'read_bytes', read):
            self.assertEqual(HELPER.load_plan(self.stand.plan_path)['runId'], RUN)
            self.plan['machineIdSha256'] = hashlib.sha256(machine.strip()).hexdigest()
            HELPER.write_private(self.stand.plan_path, self.plan)
            with self.assertRaisesRegex(HELPER.Refused, 'dedicated-machine-identity-mismatch'):
                HELPER.load_plan(self.stand.plan_path)

    def test_insufficient_cpu_or_memory_reserve_prevents_container_creation(self):
        original = Path.read_text
        for cores, available in [(19, 47365), (20, 47103)]:
            def read(path, *args, **kwargs):
                if str(path) == '/proc/stat':
                    return 'cpu 0 0 0 1\n' + ''.join(f'cpu{index} 0 0 0 1\n' for index in range(cores))
                if str(path) == '/proc/meminfo':
                    return 'MemAvailable: ' + str(available * 1024) + ' kB\n'
                return original(path, *args, **kwargs)
            with self.subTest(cores=cores, available=available), patch.object(Path, 'read_text', read), \
                    self.assertRaisesRegex(HELPER.Refused, 'insufficient-dedicated-host-reserve'):
                self.stand.create()
            self.assertEqual(self.docker.mutations(), [])

    def test_private_files_reject_public_permissions_symlinks_and_oversized(self):
        file = self.root / 'private.json'
        HELPER.write_private(file, {'safe': True})
        self.assertTrue(HELPER.private_json(file)['safe'])
        file.chmod(0o644)
        with self.assertRaises(HELPER.Refused):
            HELPER.private_json(file)
        file.chmod(0o600)
        link = self.root / 'link.json'
        link.symlink_to(file)
        with self.assertRaises(HELPER.Refused):
            HELPER.private_json(link)
        file.write_bytes(b' ' * 65537)
        with self.assertRaises(HELPER.Refused):
            HELPER.private_json(file)

    def test_created_id_and_assets_are_pinned_before_any_start_and_caps_match(self):
        with patch.object(self.stand, 'host_gate'):
            self.assertEqual(self.stand.create(), ID)
        state = self.stand.state()
        self.assertEqual(state['containerId'], ID)
        self.assertTrue(state['assetsVerified'])
        self.assertEqual(self.docker.view['status'], 'created')
        created = self.docker.mutations()[0]
        for flag, value in [('--cpus', '18'), ('--memory', '40960m'), ('--memory-swap', '40960m'),
                            ('--pids-limit', '2048'), ('--user', '1000:1000'), ('--game-processes', '4'),
                            ('--min-rate-percent', '99'), ('--max-unacknowledged-percent', '0')]:
            self.assertEqual(created[created.index(flag) + 1], value)
        mounts = [created[index + 1] for index, value in enumerate(created) if value == '--mount']
        self.assertEqual(mounts, ['type=bind,src=' + str(self.root / 'run') + ',dst=/app/run'])
        self.assertFalse(any(args[:2] == ['docker', 'start'] for args, _ in self.docker.calls))
        self.assertFalse((self.root / 'metadata-verified.copy').exists())

    def test_changed_asset_digest_refuses_before_start(self):
        self.plan['metadataSha256'] = '0' * 64
        with patch.object(self.stand, 'host_gate'), self.assertRaisesRegex(HELPER.Refused, 'image-asset-digest-mismatch'):
            self.stand.create()
        self.assertFalse(any(args[:2] == ['docker', 'start'] for args, _ in self.docker.calls))
        self.assertEqual(self.stand.state()['containerId'], ID)

    def test_foreign_label_or_changed_container_id_never_stopped(self):
        self.state()
        for change in [{'label': 'foreign'}, {'Id': '9' * 64}, {'Image': 'sha256:' + '0' * 64}]:
            self.docker.created('running')
            self.docker.view.update(change)
            with self.subTest(change=change), self.assertRaises(HELPER.Refused):
                self.stand.stop_owned()
            self.assertEqual(self.docker.mutations(), [])

    def test_stop_timeout_has_fresh_ownership_check_before_exact_kill(self):
        self.state()
        self.docker.created('running')
        self.docker.stop_error = subprocess.TimeoutExpired(['docker', 'stop'], 10)
        self.assertEqual(self.stand.stop_owned()['status'], 'exited')
        mutations = self.docker.mutations()
        self.assertEqual(mutations, [['docker', 'stop', '-t', '5', ID], ['docker', 'kill', ID]])
        commands = [args for args, _ in self.docker.calls]
        first, last = commands.index(mutations[0]), commands.index(mutations[1])
        self.assertTrue(any(args[:2] == ['docker', 'inspect'] for args in commands[first + 1:last]))

    def test_stop_timeout_then_foreign_label_prevents_kill(self):
        self.state()
        self.docker.created('running')
        self.docker.stop_error = HELPER.Refused('bounded-command-failed')
        self.docker.replacement = {'label': 'foreign'}
        with self.assertRaises(HELPER.Refused):
            self.stand.stop_owned()
        self.assertEqual(self.docker.mutations(), [['docker', 'stop', '-t', '5', ID]])

    def test_cancel_before_or_during_host_gate_prevents_docker_create(self):
        def cancel():
            HELPER.write_private(self.root / 'stop-requested.json', {'runId': RUN})
        with patch.object(self.stand, 'host_gate', side_effect=cancel), self.assertRaisesRegex(HELPER.Refused, 'stop-requested'):
            self.stand.create()
        with self.assertRaisesRegex(HELPER.Refused, 'stop-requested'):
            self.stand.start()
        self.assertEqual(self.docker.mutations(), [])

    def test_start_returns_creating_without_waiting_for_load(self):
        child = Mock(pid=123)
        with patch.object(self.stand, 'spawn', return_value=child) as spawn:
            result = self.stand.start()
        self.assertEqual(result['phase'], 'creating')
        spawn.assert_called_once_with('supervise', 'supervisor.log')
        self.assertEqual(self.docker.mutations(), [])

    def test_stop_persists_cancel_even_when_critical_section_cannot_be_acquired(self):
        @contextmanager
        def blocked_lock():
            raise HELPER.Refused('lifecycle-lock-timeout')
            yield

        with patch.object(self.stand, 'lifecycle', blocked_lock), self.assertRaisesRegex(HELPER.Refused, 'lifecycle-lock-timeout'):
            self.stand.terminate('operator-stop')
        marker = HELPER.private_json(self.root / 'stop-requested.json')
        self.assertEqual(marker['reason'], 'operator-stop')
        with self.assertRaisesRegex(HELPER.Refused, 'stop-requested'):
            self.stand.create()
        self.assertEqual(self.docker.mutations(), [])

    def test_different_run_active_or_created_container_refuses_overlapping_resources(self):
        for status in ('created', 'running', 'paused', 'restarting', 'removing'):
            self.docker.other_stands = [('9' * 64, status)]
            with self.subTest(status=status), self.assertRaisesRegex(HELPER.Refused, 'another-dedicated-stand-active'):
                self.stand.create()
            self.assertEqual(self.docker.mutations(), [])
        self.docker.other_stands = [('9' * 64, 'exited')]
        with patch.object(self.stand, 'host_gate'):
            self.assertEqual(self.stand.create(), ID)

    def test_guardian_verdict_between_guard_read_and_completion_claim_prevents_pass(self):
        HELPER.write_private(self.stand.state_path, {'runId': RUN, 'phase': 'creating', 'deadline': 999999})
        calls = {'alive': 0}

        def spawn(mode, filename):
            HELPER.write_private(self.stand.guard_path, {'runId': RUN, 'pid': 200, 'ticks': 'ticks', 'phase': 'watching'})
            return Mock(pid=200, poll=Mock(return_value=None))

        def alive(pid, ticks):
            calls['alive'] += 1
            # Guardian readiness, pre-start and then completion after phase read.
            if calls['alive'] == 3:
                self.stand.publish_guardian_verdict('host-memory-reserve-exhausted')
            return True

        with patch.object(self.stand, 'spawn', side_effect=spawn), patch.object(self.stand, 'host_gate'), \
                patch.object(HELPER, 'process_identity', return_value='ticks'), patch.object(HELPER, 'alive', side_effect=alive), \
                patch.object(HELPER.time, 'monotonic', return_value=100), patch.object(HELPER.signal, 'signal'):
            self.stand.supervise()
        self.assertFalse(self.stand.state()['passed'])
        self.assertEqual(self.stand.state()['phase'], 'failed')
        self.assertEqual(self.docker.view['exitCode'], 0)
        self.assertEqual(HELPER.private_json(self.root / 'stop-requested.json')['reason'], 'host-memory-reserve-exhausted')

    def test_exit_zero_is_not_pass_when_guard_failed_or_cancellation_won(self):
        for failure in ('guard-dead', 'guard-abort', 'none'):
            with self.subTest(failure=failure):
                self.stand.state_path.unlink(missing_ok=True)
                self.stand.guard_path.unlink(missing_ok=True)
                (self.root / 'stop-requested.json').unlink(missing_ok=True)
                self.docker.view = None
                self.docker.calls.clear()
                HELPER.write_private(self.stand.state_path, {'runId': RUN, 'phase': 'creating', 'deadline': 999999})
                failed = {'guard': False}

                def after_start():
                    if failure == 'guard-dead':
                        failed['guard'] = True
                    elif failure == 'guard-abort':
                        self.stand.request_cancel('host-memory-reserve-exhausted')
                        HELPER.write_private(self.stand.guard_path, {'runId': RUN, 'pid': 200, 'ticks': 'ticks', 'phase': 'stopping'})

                self.docker.start_hook = after_start

                def spawn(mode, filename):
                    HELPER.write_private(self.stand.guard_path, {'runId': RUN, 'pid': 200, 'ticks': 'ticks', 'phase': 'watching'})
                    return Mock(pid=200, poll=Mock(return_value=None))

                with patch.object(self.stand, 'spawn', side_effect=spawn), patch.object(self.stand, 'host_gate'), \
                        patch.object(HELPER, 'process_identity', return_value='ticks'), \
                        patch.object(HELPER, 'alive', side_effect=lambda pid, ticks: not failed['guard']), \
                        patch.object(HELPER.time, 'monotonic', return_value=100), \
                        patch.object(HELPER.signal, 'signal'):
                    self.stand.supervise()
                state = self.stand.state()
                self.assertEqual(state['passed'], failure == 'none')
                self.assertEqual(state['phase'], 'ended' if failure == 'none' else 'failed')
                self.assertTrue(state['stopConfirmed'])
                self.assertEqual(self.docker.view['exitCode'], 0)
                if failure == 'guard-abort':
                    self.assertEqual(HELPER.private_json(self.root / 'stop-requested.json')['reason'], 'host-memory-reserve-exhausted')

    def test_timeout_guard_stops_only_owned_id_and_removes_fixture(self):
        self.docker.created('running')
        self.state(phase='running', supervisorPid=200, supervisorTicks='ticks', deadline=100)
        self.fixture()
        with patch.object(HELPER, 'process_identity', return_value='ticks'), \
                patch.object(HELPER, 'alive', return_value=True), patch.object(HELPER.time, 'monotonic', return_value=101):
            result = self.stand.watch()
        self.assertEqual(result['reason'], 'stand-timeout')
        self.assertTrue(result['stopConfirmed'])
        self.assertTrue(result['privateFixtureGone'])
        self.assertEqual(self.docker.mutations(), [['docker', 'stop', '-t', '5', ID]])
        self.assertTrue((self.root / 'stop-requested.json').exists())

    def test_supervisor_completion_between_state_read_and_liveness_check_is_not_a_crash(self):
        for phase, first_reason in [('ended', 'container-ended'), ('failed', 'supervisor-runtime-failure')]:
            with self.subTest(phase=phase):
                (self.root / 'stop-requested.json').unlink(missing_ok=True)
                self.docker.created('running')
                self.state(phase='running', supervisorPid=200, supervisorTicks='ticks', deadline=999999)

                def complete_before_dead_process_check(pid, ticks):
                    self.assertEqual((pid, ticks), (200, 'ticks'))
                    self.assertEqual(self.stand.state()['phase'], 'running')
                    self.stand.request_cancel(first_reason)
                    self.docker.view['status'] = 'exited'
                    self.state(phase=phase, supervisorPid=200, supervisorTicks='ticks', deadline=999999,
                               passed=phase == 'ended', stopConfirmed=True, privateFixtureGone=True)
                    return False

                before = len(self.docker.mutations())
                with patch.object(HELPER, 'process_identity', return_value='ticks'), \
                        patch.object(HELPER, 'alive', side_effect=complete_before_dead_process_check) as liveness:
                    result = self.stand.watch()
                liveness.assert_called_once_with(200, 'ticks')
                self.assertEqual(result['reason'], 'supervisor-completed')
                self.assertTrue(result['stopConfirmed'])
                self.assertEqual(self.stand.state()['passed'], phase == 'ended')
                self.assertEqual(HELPER.private_json(self.root / 'stop-requested.json')['reason'], first_reason)
                self.assertEqual(len(self.docker.mutations()), before)

    def test_supervisor_death_guard_is_independent_of_supervisor_loop(self):
        self.docker.created('running')
        self.state(phase='running', supervisorPid=200, supervisorTicks='ticks', deadline=999999)
        with patch.object(HELPER, 'process_identity', return_value='ticks'), patch.object(HELPER, 'alive', return_value=False):
            result = self.stand.watch()
        self.assertEqual(result['reason'], 'supervisor-not-live')
        self.assertTrue(result['stopConfirmed'])
        self.assertEqual(self.docker.mutations(), [['docker', 'stop', '-t', '5', ID]])

    def test_stop_removes_only_private_fixture_and_preserves_report(self):
        self.docker.created('running')
        self.state()
        self.fixture()
        report = self.root / 'run/server.json'
        report.write_text('{"retained":true}')
        result = self.stand.terminate('unit-stop')
        self.assertTrue(result['privateFixtureGone'])
        self.assertTrue(report.exists())
        self.assertEqual(self.docker.view['status'], 'exited')

    def test_cleanup_rejects_active_container_and_symlink(self):
        self.state()
        self.docker.created('running')
        self.fixture()
        with self.assertRaises(HELPER.Refused):
            self.stand.cleanup_fixture()
        self.docker.view['status'] = 'exited'
        self.stand.manifest.unlink()
        target = self.root / 'other-private.json'
        HELPER.write_private(target, {'secret': 'unrelated'})
        self.stand.manifest.symlink_to(target)
        with self.assertRaises(HELPER.Refused):
            self.stand.cleanup_fixture()
        self.assertTrue(target.exists())

    def test_ready_status_is_sanitized_and_requires_guard_and_asset_attestation(self):
        self.docker.created('running')
        self.state(phase='running', assetsVerified=True)
        HELPER.write_private(self.stand.guard_path, {'runId': RUN, 'phase': 'watching', 'pid': 200, 'ticks': 'ticks'})
        self.fixture()
        with patch.object(HELPER, 'alive', return_value=True):
            result = self.stand.status()
        self.assertTrue(result['ready'])
        self.assertNotIn('PRIVATE-', json.dumps(result))
        self.assertNotIn('secret', result)
        self.assertNotIn('tokens', result)
        with patch.object(HELPER, 'alive', return_value=False):
            self.assertFalse(self.stand.status()['ready'])


class TlsGatewayTests(unittest.TestCase):
    state = DedicatedStandTests.state
    fixture = DedicatedStandTests.fixture
    CERTIFICATE = b'-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----\n'
    PRIVATE_KEY = b'-----BEGIN PRIVATE KEY-----\nFAKE-PRIVATE-ONLY\n-----END PRIVATE KEY-----\n'
    STAND_RUN = 'a4e53b5a-6725-45b6-961f-670dca22bdb7'

    def setUp(self):
        DedicatedStandTests.setUp(self)
        self.plan['tlsGateway'] = dict(HELPER.TLS_GATEWAY)
        self.docker.created('running')
        self.state(phase='running', assetsVerified=True)
        HELPER.write_private(self.stand.guard_path, {'runId': RUN, 'phase': 'watching', 'pid': 200, 'ticks': 'ticks'})
        self.fixture()
        fixture = HELPER.private_json(self.stand.manifest)
        HELPER.write_private(self.stand.manifest, {**fixture, 'runId': self.STAND_RUN, 'secret': 'c' * 64})
        self.stack.enter_context(patch.object(HELPER, 'alive', return_value=True))
        self.stack.enter_context(patch.object(self.stand, 'tls_port_available'))
        self.probe = self.stack.enter_context(patch.object(self.stand, 'tls_probe'))
        self.owners = {}
        fstat = os.fstat

        def owner_stat(descriptor):
            actual = fstat(descriptor)
            result = list(actual)
            result[4] = self.owners.get((actual.st_dev, actual.st_ino), 0)
            return os.stat_result(result)

        def own(descriptor, uid, gid):
            actual = fstat(descriptor)
            self.owners[(actual.st_dev, actual.st_ino)] = uid

        self.stack.enter_context(patch.object(HELPER.os, 'fstat', side_effect=owner_stat))
        self.stack.enter_context(patch.object(HELPER.os, 'fchown', side_effect=own))
        private_write = HELPER.write_private

        def root_write(path, value):
            private_write(path, value)
            info = path.stat()
            self.owners[(info.st_dev, info.st_ino)] = 0

        self.stack.enter_context(patch.object(HELPER, 'write_private', side_effect=root_write))
        self.stack.enter_context(patch.object(HELPER, 'command', side_effect=self.command))
        self.exec_calls, self.openssl_calls = [], []
        self.failure = None
        self.start_hook = None
        self.process = {'pid': 900, 'ticks': '12345'}

    def command(self, args, **kwargs):
        if args[0] == '/usr/bin/openssl':
            self.openssl_calls.append((args, kwargs))
            self.stand.tls_write(Path(args[args.index('-keyout') + 1]), self.PRIVATE_KEY, 0)
            self.stand.tls_write(Path(args[args.index('-out') + 1]), self.CERTIFICATE, 0)
            return ''
        if args[:2] == ['docker', 'exec']:
            self.exec_calls.append((args, kwargs))
            self.assertEqual(args[args.index('--user') + 1], '1000:1000')
            self.assertIn(ID, args)
            child = args[args.index(ID) + 1:]
            if child[:2] == ['/usr/local/bin/caddy', 'validate']:
                if self.failure == 'validate':
                    raise HELPER.Refused('bounded-command-failed')
                return ''
            if child[:2] == ['node', '-e'] and "require('child_process')" in child[2]:
                self.assertIn("{stdio:'ignore'}", child[2])
                self.assertIn("['start','--config','/app/run/tls-gateway.json','--pidfile','/app/run/tls-gateway.pid']", child[2])
                self.stand.tls_write(self.root / 'run/tls-gateway.pid', b'900\n', 1000)
                if self.start_hook:
                    self.start_hook()
                if self.failure == 'start':
                    raise subprocess.TimeoutExpired(['docker', 'exec'], 15)
                return ''
            if child[:2] == ['node', '-e']:
                return '' if child[2] == 'process.exit(0)' else json.dumps(self.process)
            raise AssertionError('Unapproved TLS container command')
        return self.docker(args, **kwargs)

    def test_gateway_is_optional_and_only_exact_fixed_test_listener_is_accepted(self):
        self.assertNotIn('tlsGateway', plan())
        self.assertEqual(HELPER.validate({**plan(), 'tlsGateway': dict(HELPER.TLS_GATEWAY)})['tlsGateway'], HELPER.TLS_GATEWAY)
        for value in [{'port': 443, 'serverName': 'royal-load.test'}, {'port': 26443, 'serverName': 'production.example'},
                      {**HELPER.TLS_GATEWAY, 'enabled': True}, {'port': '26443', 'serverName': 'royal-load.test'}, None]:
            with self.subTest(value=value), self.assertRaises(HELPER.Refused):
                HELPER.validate({**plan(), 'tlsGateway': value})

    def test_gateway_uses_manual_tls_wildcard_and_exact_game_route_allowlist(self):
        config = self.stand.tls_config(38001)
        server = config['apps']['http']['servers']['gateway']
        self.assertEqual(server['listen'], [':26443'])
        self.assertTrue(config['admin']['disabled'])
        self.assertTrue(server['automatic_https']['disable'])
        self.assertEqual(server['protocols'], ['h1'])
        route, rejected = server['routes']
        self.assertEqual(route['handle'][0]['upstreams'], [{'dial': '127.0.0.1:38001'}])
        self.assertEqual(route['handle'][0]['headers']['request']['set'], {'Host': ['127.0.0.1:38001']})
        self.assertEqual(rejected['handle'][0]['status_code'], 404)
        self.assertNotIn('host', json.dumps(route))

        def allowed(method, path, upgrade=None):
            for condition in route['match']:
                if method not in condition['method']:
                    continue
                if 'header' in condition and upgrade not in condition['header']['Upgrade']:
                    continue
                if 'path' in condition and path not in condition['path']:
                    continue
                if 'path_regexp' in condition and not re.fullmatch(condition['path_regexp']['pattern'], path):
                    continue
                return True
            return False

        for method, path, upgrade in [('GET', '/__load-stand/status', None), ('POST', '/matchmake/joinOrCreate/lobby', None),
                                      ('POST', '/matchmake/reconnect/room_1', None), ('POST', '/matchmake/joinById/room-1', None),
                                      ('GET', '/workers/main/process/room', 'websocket'),
                                      ('GET', '/workers/worker-3/process/room', 'websocket')]:
            with self.subTest(path=path):
                self.assertTrue(allowed(method, path, upgrade))
        for method, path, upgrade in [('POST', '/abort', None), ('POST', '/results', None), ('GET', '/healthz', None),
                                      ('POST', '/api/auth/login', None), ('GET', '/api/account', None),
                                      ('POST', '/matchmake/create/lobby', None), ('GET', '/workers/worker-4/process/room', 'websocket'),
                                      ('GET', '/workers/main/process/room', None), ('POST', '/__load-stand/status', None),
                                      ('POST', '/matchmake/reconnect/' + 'x' * 65, None),
                                      ('GET', '/workers/main/../../control', 'websocket')]:
            with self.subTest(path=path):
                self.assertFalse(allowed(method, path, upgrade))

    def test_start_pins_process_cert_config_and_secrets_never_enter_safe_response(self):
        result = self.stand.tls_start()
        self.assertTrue(result['ready'])
        self.assertEqual(result['standRunId'], self.STAND_RUN)
        self.assertEqual(result['certificateSha256'], hashlib.sha256(self.CERTIFICATE).hexdigest())
        self.assertEqual((result['caddyPid'], result['caddyStartTicks']), (900, '12345'))
        self.assertEqual(len(self.openssl_calls), 1)
        self.assertTrue(all(args[args.index(ID) + 1] in ['node', '/usr/local/bin/caddy'] for args, _ in self.exec_calls))
        for path, uid, modes, limit in self.stand.tls_assets()[3:6]:
            self.stand.tls_read(path, uid, modes, limit)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        public = self.stand.tls_certificate()
        self.assertEqual(public['certificatePEM'].encode(), self.CERTIFICATE)
        safe = json.dumps([result, public, self.stand.status(), self.openssl_calls, self.exec_calls])
        self.assertNotIn('FAKE-PRIVATE-ONLY', safe)
        self.assertNotIn('PRIVATE-CONTROL-SECRET', safe)
        self.assertNotIn('PRIVATE-TOKEN', safe)
        self.assertNotIn('keySha256', result)
        self.assertFalse((self.root / 'tls-private.generated.pem').exists())

    def test_ready_refuses_changed_assets_process_and_stand_nonce(self):
        self.stand.tls_start()
        for name in ['tls-public.pem', 'run/tls-gateway.key.pem', 'run/tls-gateway.cert.pem', 'run/tls-gateway.json']:
            path = self.root / name
            original = path.read_bytes()
            path.write_bytes(original + b'changed')
            with self.subTest(name=name), self.assertRaises(HELPER.Refused):
                self.stand.tls_status()
            path.write_bytes(original)
        self.process['ticks'] = '12346'
        with self.assertRaisesRegex(HELPER.Refused, 'tls-process-changed'):
            self.stand.tls_status()
        self.process['ticks'] = '12345'
        fixture = HELPER.private_json(self.stand.manifest)
        HELPER.write_private(self.stand.manifest, {**fixture, 'runId': RUN})
        with self.assertRaisesRegex(HELPER.Refused, 'tls-stand-run-changed'):
            self.stand.tls_status()

    def test_readiness_requires_live_guard_and_cancellation_cannot_be_ready(self):
        self.stand.tls_start()
        with patch.object(HELPER, 'alive', return_value=False):
            self.assertFalse(self.stand.tls_status()['ready'])
        self.stand.request_cancel('operator-stop')
        self.assertFalse(self.stand.tls_status()['ready'])
        self.assertFalse(self.stand.status()['tlsGateway']['ready'])

    def test_failed_launch_or_attestation_stops_owned_container_and_purges_private_assets(self):
        for failure in ['validate', 'start', 'probe']:
            with self.subTest(failure=failure):
                self.failure = failure
                if failure == 'probe':
                    self.probe.side_effect = HELPER.Refused('tls-attestation-rejected')
                with self.assertRaises((HELPER.Refused, subprocess.TimeoutExpired)):
                    self.stand.tls_start()
                self.assertEqual(self.docker.view['status'], 'exited')
                self.assertFalse(self.stand.manifest.exists())
                self.assertTrue(all(not path.exists() for path, *_ in self.stand.tls_assets()))
                diagnostic = HELPER.private_json(self.stand.tls_state_path)
                self.assertEqual(diagnostic['phase'], 'closed')
                self.assertEqual(diagnostic['failureStage'], {'validate': 'config-validate', 'start': 'caddy-start',
                                                             'probe': 'tls-attestation'}[failure])
                self.assertEqual(diagnostic['failureCode'], {'validate': 'bounded-command-failed', 'start': 'bounded-command-timeout',
                                                            'probe': 'tls-attestation-rejected'}[failure])
                status = self.stand.tls_status()
                self.assertEqual(status['failureStage'], diagnostic['failureStage'])
                self.assertEqual(status['failureCode'], diagnostic['failureCode'])
                self.stand.tls_state_path.unlink()
                (self.root / 'stop-requested.json').unlink()
                self.docker.created('running')
                self.fixture()
                self.probe.side_effect = None

    def test_cancellation_during_caddy_start_cannot_publish_active_gateway(self):
        self.start_hook = lambda: self.stand.request_cancel('operator-stop')
        with self.assertRaisesRegex(HELPER.Refused, 'stop-requested'):
            self.stand.tls_start()
        self.assertEqual(HELPER.private_json(self.root / 'stop-requested.json')['reason'], 'operator-stop')
        self.assertEqual(HELPER.private_json(self.stand.tls_state_path)['phase'], 'closed')
        self.assertEqual(self.docker.view['status'], 'exited')
        self.assertTrue(all(not path.exists() for path, *_ in self.stand.tls_assets()))

    def test_error_classification_never_retains_raw_messages_command_output_or_private_data(self):
        for error in [RuntimeError('FAKE-PRIVATE-ONLY SQL token=secret'), HELPER.Refused('FAKE-PRIVATE-ONLY SQL token=secret'),
                      subprocess.TimeoutExpired(['PRIVATE-COMMAND'], 15, output=b'PRIVATE-OUTPUT', stderr=b'PRIVATE-STDERR'),
                      PermissionError(13, 'PRIVATE-FILE-AND-TOKEN')]:
            classified = HELPER.tls_failure_code(error)
            self.assertNotIn('PRIVATE', classified)
            self.assertNotIn('SQL', classified)
        self.probe.side_effect = HELPER.Refused('FAKE-PRIVATE-ONLY SQL token=secret')
        with self.assertRaisesRegex(HELPER.Refused, '^dedicated-stand-failed$'):
            self.stand.tls_start()
        metadata = HELPER.private_json(self.stand.tls_state_path)
        self.assertEqual(metadata['failureStage'], 'tls-attestation')
        self.assertEqual(metadata['failureCode'], 'dedicated-stand-failed')
        self.assertNotIn('FAKE-PRIVATE-ONLY', json.dumps(metadata))
        self.assertEqual(self.docker.view['status'], 'exited')
        self.assertTrue(all(not path.exists() for path, *_ in self.stand.tls_assets()))

    def test_duplicate_launch_during_lock_wait_cannot_stop_first_gateway(self):
        original_lock = self.stand.lifecycle

        @contextmanager
        def other_launch_won():
            HELPER.write_private(self.stand.tls_state_path, {'runId': RUN, 'containerId': ID,
                'imageId': self.plan['imageId'], 'phase': 'active'})
            with original_lock():
                yield

        with patch.object(self.stand, 'lifecycle', other_launch_won), self.assertRaisesRegex(HELPER.Refused, 'fresh-tls-gateway'):
            self.stand.tls_start()
        self.assertEqual(self.docker.view['status'], 'running')
        self.assertFalse((self.root / 'stop-requested.json').exists())
        self.assertEqual(self.docker.mutations(), [])

    def test_foreign_ownership_refuses_all_gateway_exec_and_asset_generation(self):
        self.docker.view['label'] = 'foreign'
        with self.assertRaisesRegex(HELPER.Refused, 'container-ownership-changed'):
            self.stand.tls_start()
        self.assertEqual(self.exec_calls, [])
        self.assertEqual(self.openssl_calls, [])
        self.assertEqual(self.docker.mutations(), [])

    def test_stop_removes_certificate_key_config_pid_and_generated_leftovers_only(self):
        self.stand.tls_start()
        report = self.root / 'run/server.json'
        report.write_text('{"preserved":true}')
        self.stand.tls_write(self.root / 'tls-private.generated.pem', self.PRIVATE_KEY, 0)
        with self.assertRaisesRegex(HELPER.Refused, 'inactive-owned-container-required'):
            self.stand.cleanup_tls(ID)
        result = self.stand.terminate('operator-stop')
        self.assertTrue(result['stopConfirmed'])
        self.assertTrue(result['privateFixtureGone'])
        self.assertTrue(result['tlsGatewayClosed'])
        self.assertTrue(result['tlsAssetsRemoved'])
        self.assertTrue(report.exists())
        status = self.stand.tls_status()
        self.assertTrue(status['closed'])
        self.assertTrue(status['assetsRemoved'])
        self.assertFalse(status['ready'])

    def test_cleanup_rejects_symlink_wrong_owner_and_public_private_key(self):
        self.docker.view['status'] = 'exited'
        path = self.root / 'run/tls-gateway.key.pem'
        target = self.root / 'unrelated-private.pem'
        self.stand.tls_write(target, self.PRIVATE_KEY, 0)
        path.symlink_to(target)
        with self.assertRaises(OSError):
            self.stand.cleanup_tls(ID)
        self.assertTrue(target.exists())
        path.unlink()
        self.stand.tls_write(path, self.PRIVATE_KEY, 0)
        with self.assertRaises(HELPER.Refused):
            self.stand.cleanup_tls(ID)
        path.unlink()
        self.stand.tls_write(path, self.PRIVATE_KEY, 1000)
        path.chmod(0o644)
        with self.assertRaises(HELPER.Refused):
            self.stand.cleanup_tls(ID)
        self.stand.manifest.unlink()
        self.assertFalse(self.stand.status()['privateFixtureGone'])

    def test_tls_probe_has_total_deadline_and_restores_signal_handler(self):
        with patch.object(HELPER.signal, 'getsignal', return_value='previous'), \
                patch.object(HELPER.signal, 'getitimer', return_value=(0, 0)), \
                patch.object(HELPER.signal, 'signal') as handler, patch.object(HELPER.signal, 'setitimer') as timer, \
                patch.object(self.stand, 'tls_probe_connection', side_effect=HELPER.Refused('tls-attestation-rejected')):
            with self.assertRaisesRegex(HELPER.Refused, 'tls-attestation-rejected'):
                HELPER.Stand.tls_probe(self.stand, {}, self.CERTIFICATE)
        self.assertEqual(timer.call_args_list[0].args, (HELPER.signal.ITIMER_REAL, 6))
        self.assertEqual(timer.call_args_list[-1].args, (HELPER.signal.ITIMER_REAL, 0))
        self.assertEqual(handler.call_args_list[-1].args, (HELPER.signal.SIGALRM, 'previous'))

    def test_tls_attestation_pins_peer_certificate_nonce_and_bounded_response(self):
        fixture = HELPER.private_json(self.stand.manifest)
        value = {key: fixture.get(key) for key in ['protocol', 'role', 'runId', 'bundleSha256', 'clients', 'seconds',
                                                 'gameProcesses', 'apiEndpoint', 'expiresAt', 'serverHost']}
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.getpeercert.return_value = b'\x01\x02\x03'
        context = MagicMock()
        context.wrap_socket.return_value = connection
        response = Mock(status=200)
        response.read.return_value = json.dumps(value).encode()
        with patch.object(HELPER.ssl, 'create_default_context', return_value=context), \
                patch.object(HELPER.socket, 'create_connection', return_value=MagicMock()) as connect, \
                patch.object(HELPER.http.client, 'HTTPResponse', return_value=response):
            self.stand.tls_probe_connection(fixture, self.CERTIFICATE)
            connect.assert_called_with(('127.0.0.1', 26443), timeout=3)
            self.assertEqual(context.wrap_socket.call_args.kwargs['server_hostname'], 'royal-load.test')
            self.assertIn(b'Authorization: Bearer ' + fixture['secret'].encode(), connection.sendall.call_args.args[0])
            self.assertEqual(response.read.call_args.args, (65537,))
            response.read.return_value = json.dumps({**value, 'runId': RUN}).encode()
            with self.assertRaisesRegex(HELPER.Refused, 'tls-attestation-mismatch'):
                self.stand.tls_probe_connection(fixture, self.CERTIFICATE)
            for malformed in [b'', b'[]', b'null', b'not-json']:
                response.read.return_value = malformed
                with self.subTest(malformed=malformed), self.assertRaisesRegex(HELPER.Refused, 'tls-attestation-malformed-response'):
                    self.stand.tls_probe_connection(fixture, self.CERTIFICATE)
            response.read.return_value = b' ' * 65537
            with self.assertRaisesRegex(HELPER.Refused, 'tls-attestation-rejected'):
                self.stand.tls_probe_connection(fixture, self.CERTIFICATE)
            connection.getpeercert.return_value = b'different'
            with self.assertRaisesRegex(HELPER.Refused, 'tls-peer-certificate-mismatch'):
                self.stand.tls_probe_connection(fixture, self.CERTIFICATE)


if __name__ == '__main__':
    unittest.main()
