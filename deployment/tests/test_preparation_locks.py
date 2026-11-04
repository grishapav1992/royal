"""Exercise real POSIX locks with disposable packages, never production paths."""
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
if sys.platform == 'win32':
    sys.modules.setdefault('fcntl', types.SimpleNamespace())
import fcntl

REPOSITORY = Path(__file__).resolve().parents[2]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, REPOSITORY / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


walk = load('walk_preparation', 'deployment/releases/front-back-walk-20261104-v3/deploy.py')
recovery = load('recovery_preparation', 'deployment/releases/player-recovery-20261104-v2/reservation.py')


@unittest.skipIf(sys.platform == 'win32', 'Real flock concurrency checks require Linux')
class PreparationLocksTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.locks = [str(self.root / name) for name in ['application.lock', 'client.lock', 'modules.lock']]
        for module in [walk, recovery]:
            self.patch(module, 'LOCKS', self.locks)

    def patch(self, module, name, value):
        context = patch.object(module, name, value)
        self.addCleanup(context.stop)
        return context.start()

    def assert_available(self):
        for name in self.locks:
            with open(name, 'a') as handle:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def assert_held(self):
        for name in self.locks:
            with open(name, 'a') as handle:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_both_installers_hold_all_locks_only_inside_the_context(self):
        for module in [walk, recovery]:
            with self.subTest(module=module.__name__):
                self.assert_available()
                with module.publication_locks():
                    self.assert_held()
                self.assert_available()

    def test_busy_second_lock_releases_the_first_without_waiting(self):
        for module in [walk, recovery]:
            with self.subTest(module=module.__name__), open(self.locks[1], 'a') as blocker:
                fcntl.flock(blocker, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaises(module.PublicationBusy):
                    with module.publication_locks():
                        self.fail('Busy publisher entered the critical section')
                for name in [self.locks[0], self.locks[2]]:
                    with open(name, 'a') as available:
                        fcntl.flock(available, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assert_available()

    def test_exception_releases_all_locks(self):
        for module in [walk, recovery]:
            with self.subTest(module=module.__name__):
                with self.assertRaisesRegex(RuntimeError, 'installer failed'):
                    with module.publication_locks():
                        raise RuntimeError('installer failed')
                self.assert_available()

    def test_symlink_lock_is_rejected_and_partial_locks_are_released(self):
        target = self.root / 'foreign.lock'
        target.touch()
        alias = self.root / 'alias.lock'
        alias.symlink_to(target)
        for module in [walk, recovery]:
            with self.subTest(module=module.__name__), patch.object(module, 'LOCKS', [self.locks[0], str(alias)]):
                with self.assertRaisesRegex(RuntimeError, 'symlink'):
                    with module.publication_locks():
                        self.fail('Symlink was accepted')
                self.assert_available()

    def walk_fixture(self):
        root = self.root / walk.NAME
        root.mkdir()
        (root / 'deploy.py').write_text('reviewed installer')
        self.patch(walk, 'ROOT', root)
        self.patch(walk, 'Path', lambda value: self.root if value == '/opt/royal-releases' else Path(value))
        base = types.SimpleNamespace(payload=Mock(), build=Mock(return_value={'built': True}), publish=Mock(return_value={'published': True}))
        self.patch(walk, 'configure', Mock(return_value=base))
        return root, base

    def test_another_release_can_acquire_locks_while_waiting_for_the_walk_package(self):
        root, base = self.walk_fixture()
        original_wait = walk.wait_for_ready

        def prepare(directory, nonce):
            self.assert_available()
            state = json.loads((root / 'reservation-status.json').read_text())
            self.assertEqual(state['stage'], 'preparing_without_publication_locks')
            self.assertIs(state['publicationLocksHeld'], False)
            (root / 'install-manifest.json').write_text('{}')
            (root / 'reservation-ready.json').write_text(json.dumps({'reservation': nonce, 'installManifestSha256': walk.sha(root / 'install-manifest.json')}))
            original_wait(directory, nonce, 1)
            self.assert_available()

        self.patch(walk, 'wait_for_ready', prepare)
        base.build.side_effect = lambda: (self.assert_held(), {'built': True})[1]
        base.publish.side_effect = lambda: (self.assert_held(), {'published': True})[1]
        walk.reserve_release()
        base.build.assert_called_once()
        base.publish.assert_called_once()
        self.assert_available()
        self.assertEqual(json.loads((root / 'reservation-status.json').read_text())['stage'], 'published')

    def test_walk_preparation_failure_never_enters_the_installer(self):
        _, base = self.walk_fixture()

        def failed_preparation(*args):
            self.assert_available()
            raise TimeoutError('tests did not finish')

        self.patch(walk, 'wait_for_ready', failed_preparation)
        with self.assertRaises(TimeoutError):
            walk.reserve_release()
        base.build.assert_not_called()
        base.publish.assert_not_called()
        self.assert_available()

    def test_changed_baseline_aborts_before_publication_and_releases_locks(self):
        _, base = self.walk_fixture()
        base.build.side_effect = RuntimeError('Production source changed since review')
        status = Mock()
        with self.assertRaisesRegex(RuntimeError, 'Production source changed'):
            walk.install_prepared(status)
        base.publish.assert_not_called()
        self.assertEqual(status.call_args.args, ('failed',))
        self.assertIs(status.call_args.kwargs['publicationLocksHeld'], False)
        self.assert_available()

    def test_busy_walk_install_keeps_prepared_files_and_does_not_build(self):
        root, base = self.walk_fixture()
        prepared = root / 'install-manifest.json'
        prepared.write_text('immutable prepared package')
        status = Mock()
        with open(self.locks[1], 'a') as blocker:
            fcntl.flock(blocker, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(walk.PublicationBusy):
                walk.install_prepared(status)
        self.assertEqual(prepared.read_text(), 'immutable prepared package')
        base.build.assert_not_called()
        base.publish.assert_not_called()
        self.assertEqual(status.call_args.args, ('publication_busy',))
        self.assert_available()

    def test_republication_reuses_the_existing_candidate_under_locks(self):
        root, base = self.walk_fixture()
        (root / 'build-result.json').write_text('{}')
        base.publish.side_effect = lambda: (self.assert_held(), {'published': True})[1]
        walk.install_prepared(Mock(), reuse_candidate=True)
        base.build.assert_not_called()
        base.publish.assert_called_once()
        self.assert_available()

    def recovery_fixture(self):
        root = self.root / 'player-recovery-20261104-v2'
        root.mkdir()
        (root / 'deploy.py').write_text('reviewed installer')
        before = {'sourceCommit': 'production', 'container': {'image': 'image-before'}, 'program': {'index': 'reviewed'}}
        self.patch(recovery, 'ROOT', root)
        self.patch(recovery, 'Path', lambda value: root if value == '/opt/royal-releases/player-recovery-20261104-v2' else Path(value))
        capture = self.patch(recovery, 'capture_baseline', Mock(side_effect=lambda: (self.assert_available(), before)[1]))
        self.patch(recovery, 'graphs', Mock(side_effect=lambda state: (self.assert_available(), ({}, {}))[1]))
        base = types.SimpleNamespace(payload=Mock(), build=Mock(return_value={'built': True}), publish=Mock(return_value={'published': True}))
        module = types.SimpleNamespace(configure=Mock(return_value=base))
        self.patch(recovery.importlib.util, 'spec_from_file_location', Mock(return_value=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda target: None))))
        self.patch(recovery.importlib.util, 'module_from_spec', Mock(return_value=module))

        def prepare(*args):
            self.assert_available()
            manifest = {'before': before, 'sourceCommit': 'prepared', 'helperSha256': recovery.sha(root / 'deploy.py')}
            (root / 'install-manifest.json').write_text(json.dumps(manifest))
            (root / 'ready.json').write_text(json.dumps({'sourceCommit': 'prepared', 'installerSha256': manifest['helperSha256']}))

        self.patch(recovery, 'wait_for_ready', Mock(side_effect=prepare))
        base.build.side_effect = lambda: (self.assert_held(), {'built': True})[1]
        base.publish.side_effect = lambda: (self.assert_held(), {'published': True})[1]
        return root, base, capture

    def test_recovery_snapshot_and_tests_do_not_hold_locks(self):
        root, base, capture = self.recovery_fixture()
        recovery.main()
        capture.assert_called_once()
        base.build.assert_called_once()
        base.publish.assert_called_once()
        self.assert_available()
        self.assertIs(json.loads((root / 'reservation-status.json').read_text())['publicationLocksHeld'], False)

    def test_busy_recovery_can_retry_the_same_package_without_recapturing_the_baseline(self):
        root, base, capture = self.recovery_fixture()
        original_prepare = recovery.wait_for_ready.side_effect

        def busy_prepare(*args):
            original_prepare(*args)
            blocker = open(self.locks[1], 'a')
            self.addCleanup(blocker.close)
            fcntl.flock(blocker, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.blocker = blocker

        recovery.wait_for_ready.side_effect = busy_prepare
        with self.assertRaises(recovery.PublicationBusy):
            recovery.main()
        before_bytes = (root / 'reserved-before.json').read_bytes()
        package_bytes = (root / 'install-manifest.json').read_bytes()
        base.build.assert_not_called()
        base.publish.assert_not_called()
        self.blocker.close()
        recovery.wait_for_ready.side_effect = lambda *args: self.assert_available()
        recovery.main()
        capture.assert_called_once()
        self.assertEqual((root / 'reserved-before.json').read_bytes(), before_bytes)
        self.assertEqual((root / 'install-manifest.json').read_bytes(), package_bytes)
        base.build.assert_called_once()
        base.publish.assert_called_once()
        self.assert_available()

    def test_recovery_rejects_changed_baseline_before_publishing(self):
        _, base, _ = self.recovery_fixture()
        base.build.side_effect = RuntimeError('Running game changed since review')
        with self.assertRaisesRegex(RuntimeError, 'Running game changed'):
            recovery.main()
        base.publish.assert_not_called()
        self.assert_available()

    def test_unlocked_snapshot_rejects_a_container_replacement(self):
        release = self.root / 'installed-release'
        release.mkdir()
        (release / 'build-result.json').write_text(json.dumps({'image': 'image-before'}))
        (release / 'published.json').write_text('{}')
        before = {'container': {'id': 'old', 'image': 'image-before', 'startedAt': 'start'},
                  'program': {}, 'preparedProgram': {}, 'preparedImage': 'image-before'}
        self.patch(recovery, 'Path', lambda value: self.root if value == '/opt/royal-releases' else Path(value))
        self.patch(recovery, 'runtime_identity', Mock(side_effect=['old image-before start', 'new image-before start']))
        self.patch(recovery.subprocess, 'check_output', Mock(return_value=json.dumps(before)))
        with self.assertRaisesRegex(RuntimeError, 'changed during preparation snapshot'):
            recovery.capture_baseline()
        self.assert_available()


if __name__ == '__main__':
    unittest.main()
