"""Exercise Cosmic package publication and pointer recovery without production access."""
from pathlib import Path
from types import SimpleNamespace
import copy
import hashlib
import importlib.util
import io
import json
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

try:
    import fcntl
except ImportError:
    sys.modules['fcntl'] = SimpleNamespace(LOCK_EX=2, LOCK_NB=4)

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
GAME = 'studio-cosmic-escape'
sha = lambda value: hashlib.sha256(value).hexdigest()


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


class CosmicModuleReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        self.root, self.live, self.modules, self.state, self.backup = [root / name for name in ['payload', 'live', 'modules', 'state', 'backup']]
        for path in [self.root, self.live, self.modules, self.state, self.backup]:
            path.mkdir()
        shutil.copy2(HERE / 'modules.py', self.root / 'modules.py')
        for name in ['deploy.py', 'snapshot.py']:
            (self.root / name).write_text('# reviewed helper fixture\n')
        target = self.live / 'scripts/game-module-release.py'
        target.parent.mkdir()
        shutil.copy2(PROJECT / 'scripts/game-module-release.py', target)
        self.old_version, self.version = '1.0.0-aaaaaaaaaaaa', '1.0.0-bbbbbbbbbbbb'
        self.package(self.modules / GAME / 'versions' / self.old_version, self.old_version, b'old Cosmic')
        pointer = self.modules / GAME / 'active.json'
        self.old_pointer = (json.dumps({'format': 1, 'gameId': GAME,
                'manifest': '/game-modules/' + GAME + '/versions/' + self.old_version + '/manifest.json',
                'sha256': sha((self.modules / GAME / 'versions' / self.old_version / 'manifest.json').read_bytes())},
                separators=(',', ':')) + '\n').encode()
        pointer.write_bytes(self.old_pointer)
        other = self.modules / 'studio-dracona' / 'active.json'
        other.parent.mkdir()
        other.write_bytes(b'retained unrelated pointer\n')
        host = {'format': 1, 'games': {GAME: {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 1},
                                     'studio-dracona': {'apiVersion': 1, 'rulesVersion': 3, 'progressVersion': 3}}}
        save_json(self.state / 'host.json', host)
        shutil.copy2(self.state / 'host.json', self.root / 'host.json')
        package_root = self.root / 'modules' / GAME / 'versions' / self.version
        self.metadata = self.package(package_root, self.version, b'new Cosmic with origin guard')
        delta = {str(path.relative_to(self.root / 'modules')): sha(path.read_bytes()) for path in package_root.rglob('*') if path.is_file()}
        old_image, new_image = 'sha256:' + 'a' * 64, 'sha256:' + 'b' * 64
        before = {'sourceRevision': 'a' * 40,
            'source': {'src/shared/luelonSlotsLines.ts': sha(b'old validator'),
                       'scripts/game-module-release.py': sha(target.read_bytes())},
            'program': {'dist/index.html': sha(b'old index'), 'dist/assets/old.js': sha(b'old asset'),
                        'dist-server/index.js': sha(b'old backend'), 'dist-server/payments.js': sha(b'payment backend')},
            'configHashes': {'.env': sha(b'private settings')},
            'moduleFiles': self.module_files(), 'moduleHostContract': sha((self.state / 'host.json').read_bytes()), 'moduleHost': host,
            'realMoneyFlags': {'enabled': 'false'},
            'services': {'/royal-game-1': {'id': 'old game'}, '/royal-payments-1': {'id': 'payment service'}},
            'container': {'id': 'old game', 'image': old_image, 'health': 'healthy', 'startedAt': 'old start',
                          'mounts': [{'Destination': '/app/data', 'Name': 'game_data'}], 'host': {'Memory': 1},
                          'runtimeHash': sha(b'runtime settings'), 'composeFiles': 'compose.yaml'},
            'preparedImage': old_image}
        before['preparedProgram'] = copy.deepcopy(before['program'])
        manifest = {'release': 'cosmic-origin-20261026-v1', 'sourceCommit': 'c' * 40, 'before': before,
                    'changed': {'src/shared/luelonSlotsLines.ts': sha(b'fixed validator')},
                    'delta': {'index.html': sha(b'new index'), 'assets/new.js': sha(b'new asset')},
                    'serverDelta': {'index.js': sha(b'fixed backend')},
                    'moduleDelta': delta,
                    'modulePackages': [{'gameId': GAME, 'version': self.version, 'beforeSha256': sha(self.old_pointer)}],
                    'hostContractSha256': before['moduleHostContract']}
        for name, key in [('modules.py', 'modulesHelperSha256'), ('deploy.py', 'helperSha256'), ('snapshot.py', 'snapshotSha256')]:
            manifest[key] = sha((self.root / name).read_bytes())
        save_json(self.root / 'install-manifest.json', manifest)
        spec = importlib.util.spec_from_file_location('cosmic_modules_under_test', self.root / 'modules.py')
        self.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.helper)
        helper = self.helper
        helper.EXPECTED_ROOT = self.root
        helper.LIVE, helper.STATE, helper.MODULES, helper.BACKUP = self.live, self.state, self.modules, self.backup
        self.built = {'image': new_image, 'sourceCommit': manifest['sourceCommit'], 'program': helper.expected_program()}
        self.after = copy.deepcopy(before)
        self.after['source'].update(manifest['changed'])
        self.after['sourceRevision'] = manifest['sourceCommit']
        self.after['container'].update({'id': 'new game', 'image': new_image, 'startedAt': 'new start'})
        self.after['services']['/royal-game-1']['id'] = 'new game'
        self.after.update({'preparedImage': new_image, 'program': copy.deepcopy(self.built['program']),
                           'preparedProgram': copy.deepcopy(self.built['program'])})
        save_json(self.root / 'build-result.json', self.built)
        save_json(self.root / 'after.json', self.after)
        save_json(self.root / 'published.json', {'published': True, 'sourceCommit': manifest['sourceCommit'],
                    'runningImage': new_image, 'preparedImage': new_image})
        helper.snapshot = self.snapshot
        self.disk = patch.object(helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024**3))
        self.disk.start()
        self.addCleanup(self.disk.stop)

    def module_files(self):
        return {str(path): sha(path.read_bytes()) for path in self.modules.rglob('*') if path.is_file()}

    def snapshot(self):
        state = copy.deepcopy(self.after)
        state['moduleFiles'] = self.module_files()
        state['moduleHostContract'] = sha((self.state / 'host.json').read_bytes())
        state['moduleHost'] = json.loads((self.state / 'host.json').read_text())
        return state

    def package(self, root, version, entry):
        root.mkdir(parents=True)
        style = b'.cosmic { color: purple; }'
        files = {'entry-' + sha(entry)[:16] + '.js': entry, 'style-' + sha(style)[:16] + '.css': style}
        for name, content in files.items():
            (root / name).write_bytes(content)
        metadata = {'format': 1, 'gameId': GAME, 'version': version, 'apiVersion': 1, 'rulesVersion': 2,
                    'progressVersion': 1, 'sourceSha256': 'e' * 64,
                    'entry': next(name for name in files if name.endswith('.js')),
                    'styles': [next(name for name in files if name.endswith('.css'))],
                    'files': {name: sha(content) for name, content in files.items()}}
        save_json(root / 'manifest.json', metadata)
        return metadata

    def publish(self):
        return self.helper.publish()

    def test_check_uses_real_installer_and_leaves_all_pointers_unchanged(self):
        before = self.module_files()
        _installer, metadata, result = self.helper.check()
        self.assertEqual(metadata['version'], self.version)
        self.assertTrue(result['verified'])
        self.assertEqual(self.module_files(), before)
        self.assertEqual(list(self.backup.iterdir()), [])

    def test_publication_changes_only_cosmic_pointer_and_adds_exact_version(self):
        original = self.module_files()
        host = (self.state / 'host.json').read_bytes()
        result = self.publish()
        self.assertTrue(result['published'])
        actual = self.module_files()
        pointer = str(self.modules / GAME / 'active.json')
        for name, value in original.items():
            if name != pointer:
                self.assertEqual(actual[name], value, name)
        expected = {str(self.modules / name) for name in self.helper.M['moduleDelta']}
        self.assertEqual(set(actual) - set(original), expected)
        self.assertEqual((self.state / 'host.json').read_bytes(), host)
        self.assertEqual((self.backup / 'cosmic-active.json').read_bytes(), self.old_pointer)
        self.assertFalse(result['applicationRollbackPerformed'])

    def test_rollback_restores_exact_original_pointer_bytes_and_retains_new_urls(self):
        self.publish()
        added = {str(self.modules / name): value for name, value in self.helper.M['moduleDelta'].items()}
        result = self.helper.rollback()
        self.assertTrue(result['restored'])
        self.assertTrue(result['immutableVersionRetained'])
        self.assertEqual((self.modules / GAME / 'active.json').read_bytes(), self.old_pointer)
        for name, value in added.items():
            self.assertEqual(sha(Path(name).read_bytes()), value)
        self.assertEqual(self.snapshot()['program'], self.built['program'])

    def test_absent_external_pointer_install_and_rollback_preserve_bundled_fallback(self):
        pointer = self.modules / GAME / 'active.json'
        pointer.unlink()
        self.helper.OLD['moduleFiles'].pop(str(pointer))
        self.helper.M['modulePackages'][0]['beforeSha256'] = 'none'
        self.after['moduleFiles'].pop(str(pointer))
        save_json(self.root / 'after.json', self.after)
        self.publish()
        self.assertTrue(pointer.exists())
        self.helper.rollback()
        self.assertFalse(pointer.exists())
        self.assertFalse((self.backup / 'cosmic-active.json').exists())

    def test_second_publication_is_rejected(self):
        self.publish()
        with self.assertRaises(RuntimeError):
            self.publish()

    def test_package_list_rejects_another_game_or_multiple_packages(self):
        self.helper.M['modulePackages'][0]['gameId'] = 'studio-velvet-reign'
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            self.helper.payload()
        self.helper.M['modulePackages'][0]['gameId'] = GAME
        self.helper.M['modulePackages'].append(copy.deepcopy(self.helper.M['modulePackages'][0]))
        with self.assertRaisesRegex(RuntimeError, 'Exactly one Cosmic'):
            self.helper.payload()

    def test_reviewed_pointer_hash_must_match_snapshot(self):
        self.helper.M['modulePackages'][0]['beforeSha256'] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'Pointer baseline'):
            self.helper.payload()

    def test_payload_rejects_extra_files_and_other_games(self):
        extra = self.root / 'modules' / 'unreviewed.txt'
        extra.write_bytes(b'unreviewed')
        with self.assertRaisesRegex(RuntimeError, 'inventory differs'):
            self.helper.payload()
        extra.unlink()
        self.helper.M['moduleDelta']['studio-dracona/active.json'] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'Only the reviewed Cosmic'):
            self.helper.payload()

    def test_helper_and_installer_hash_changes_are_rejected(self):
        for path, message in [(self.root / 'modules.py', 'Release helper changed'),
                              (self.root / 'deploy.py', 'Release helper changed'),
                              (self.root / 'snapshot.py', 'Release helper changed'),
                              (self.live / 'scripts/game-module-release.py', 'Installed module installer changed')]:
            original = path.read_bytes()
            path.write_bytes(original + b'\n# changed\n')
            with self.assertRaisesRegex(RuntimeError, message):
                self.helper.payload()
            path.write_bytes(original)

    def test_host_changes_are_rejected_without_writing_live_contract(self):
        prior = (self.state / 'host.json').read_bytes()
        self.helper.M['hostContractSha256'] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'Host contract bytes'):
            self.helper.payload()
        self.assertEqual((self.state / 'host.json').read_bytes(), prior)

    def test_wrong_contract_or_version_is_rejected(self):
        manifest = self.root / 'modules' / GAME / 'versions' / self.version / 'manifest.json'
        metadata = json.loads(manifest.read_text())
        metadata['rulesVersion'] = 3
        save_json(manifest, metadata)
        key = GAME + '/versions/' + self.version + '/manifest.json'
        self.helper.M['moduleDelta'][key] = sha(manifest.read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'incompatible'):
            self.helper.payload()
        metadata['rulesVersion'], metadata['version'] = 2, self.old_version
        save_json(manifest, metadata)
        self.helper.M['moduleDelta'][key] = sha(manifest.read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'version differs'):
            self.helper.payload()

    def test_resource_tamper_cannot_be_hidden_by_payload_inventory(self):
        entry = self.root / 'modules' / GAME / 'versions' / self.version / self.metadata['entry']
        entry.write_bytes(b'changed executable')
        self.helper.M['moduleDelta'][str(entry.relative_to(self.root / 'modules'))] = sha(entry.read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'resource hash mismatch'):
            self.helper.payload()

    def test_payload_and_live_symlinks_are_rejected(self):
        entry = self.root / 'modules' / GAME / 'versions' / self.version / self.metadata['entry']
        content = entry.read_bytes()
        entry.unlink()
        moved = self.root / 'moved-entry'
        moved.write_bytes(content)
        entry.symlink_to(moved)
        with self.assertRaisesRegex(RuntimeError, 'symlink'):
            self.helper.payload()
        entry.unlink()
        entry.write_bytes(content)
        (self.modules / 'unsafe').symlink_to(self.root)
        with self.assertRaisesRegex(RuntimeError, 'symlink'):
            self.helper.check()

    def test_application_must_match_published_source_image_program_and_settings(self):
        for mutate in [
            lambda state: state.update({'sourceRevision': 'd' * 40}),
            lambda state: state['source'].update({'server/new.ts': 'f' * 64}),
            lambda state: state['container'].update({'id': 'later container'}),
            lambda state: state['container'].update({'health': 'unhealthy'}),
            lambda state: state['container'].update({'image': 'sha256:' + 'f' * 64}),
            lambda state: state['program'].update({'dist-server/index.js': 'f' * 64}),
            lambda state: state['preparedProgram'].update({'dist-server/index.js': 'f' * 64}),
            lambda state: state['configHashes'].update({'.env': 'f' * 64}),
            lambda state: state['container'].update({'mounts': []}),
            lambda state: state['realMoneyFlags'].update({'enabled': 'true'}),
            lambda state: state['services']['/royal-payments-1'].update({'id': 'later service'}),
        ]:
            current = self.snapshot()
            mutate(current)
            with self.assertRaises(RuntimeError):
                self.helper.application_guard(current)

    def test_build_and_published_record_tamper_are_rejected(self):
        original = (self.root / 'build-result.json').read_bytes()
        changed = copy.deepcopy(self.built)
        changed['program']['dist-server/index.js'] = 'f' * 64
        save_json(self.root / 'build-result.json', changed)
        with self.assertRaisesRegex(RuntimeError, 'build inventory'):
            self.helper.check()
        (self.root / 'build-result.json').write_bytes(original)
        published = json.loads((self.root / 'published.json').read_text())
        published['sourceCommit'] = 'd' * 40
        save_json(self.root / 'published.json', published)
        with self.assertRaisesRegex(RuntimeError, 'source differs'):
            self.helper.check()

    def test_unrelated_module_change_or_addition_blocks_publication(self):
        other = self.modules / 'studio-dracona' / 'active.json'
        original = other.read_bytes()
        other.write_bytes(b'later pointer')
        with self.assertRaisesRegex(RuntimeError, 'Unrelated module'):
            self.helper.check()
        other.write_bytes(original)
        (self.modules / 'unreviewed.txt').write_bytes(b'new unrelated file')
        with self.assertRaisesRegex(RuntimeError, 'Unrelated module'):
            self.helper.check()

    def test_disk_reserve_blocks_before_backups_or_installation(self):
        with patch.object(self.helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=5 * 1024**3)):
            with self.assertRaisesRegex(RuntimeError, 'capacity'):
                self.publish()
        self.assertEqual(list(self.backup.iterdir()), [])
        self.assertEqual((self.modules / GAME / 'active.json').read_bytes(), self.old_pointer)

    def test_immutable_url_collision_is_rejected(self):
        relative = next(iter(self.helper.M['moduleDelta']))
        self.helper.OLD['moduleFiles'][str(self.modules / relative)] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'Immutable module URL'):
            self.helper.payload()

    def test_backup_is_reused_only_with_exact_provenance_and_bytes(self):
        self.helper.backup(self.metadata)
        self.helper.backup(self.metadata)
        pointer = self.backup / 'cosmic-active.json'
        pointer.write_bytes(b'changed backup')
        with self.assertRaisesRegex(RuntimeError, 'pointer backup differs'):
            self.helper.backup(self.metadata)

    def test_incomplete_backup_is_not_overwritten(self):
        prior = b'unreviewed host backup'
        (self.backup / 'module-host.json').write_bytes(prior)
        with self.assertRaisesRegex(RuntimeError, 'Incomplete module backup'):
            self.publish()
        self.assertEqual((self.backup / 'module-host.json').read_bytes(), prior)

    def test_failure_after_pointer_replacement_restores_only_own_pointer(self):
        installer, _metadata, _result = self.helper.check()
        original = installer.run
        calls = []
        def fail_after_install(args):
            calls.append(args.operation)
            result = original(args)
            if args.operation == 'install':
                raise RuntimeError('simulated interruption after pointer publication')
            return result
        installer.run = fail_after_install
        with patch.object(self.helper, 'load_installer', return_value=installer):
            with patch.object(self.helper.signal, 'signal'):
                with self.assertRaisesRegex(RuntimeError, 'simulated interruption'):
                    self.publish()
        self.assertEqual(calls, ['check', 'install'])
        self.assertEqual((self.modules / GAME / 'active.json').read_bytes(), self.old_pointer)
        self.assertTrue((self.modules / GAME / 'versions' / self.version / 'manifest.json').exists())
        failed = json.loads((self.root / 'modules-failed.json').read_text())
        self.assertTrue(failed['pointerRestored'])
        self.assertFalse(failed['applicationRollbackPerformed'])
        self.assertEqual(self.snapshot()['program'], self.built['program'])

    def test_failure_before_pointer_change_leaves_old_pointer_and_application(self):
        installer, _metadata, _result = self.helper.check()
        original = installer.run
        def fail_before_install(args):
            if args.operation == 'install':
                raise RuntimeError('simulated copy failure')
            return original(args)
        installer.run = fail_before_install
        with patch.object(self.helper, 'load_installer', return_value=installer):
            with patch.object(self.helper.signal, 'signal'):
                with self.assertRaisesRegex(RuntimeError, 'simulated copy failure'):
                    self.publish()
        self.assertEqual((self.modules / GAME / 'active.json').read_bytes(), self.old_pointer)
        self.assertFalse(json.loads((self.root / 'modules-failed.json').read_text())['pointerRestored'])

    def test_failure_does_not_restore_a_later_pointer(self):
        installer, _metadata, _result = self.helper.check()
        original = installer.run
        pointer = self.modules / GAME / 'active.json'
        def later_pointer(args):
            result = original(args)
            if args.operation == 'install':
                pointer.write_bytes(b'later pointer')
                raise RuntimeError('interrupted')
            return result
        installer.run = later_pointer
        with patch.object(self.helper, 'load_installer', return_value=installer):
            with patch.object(self.helper.signal, 'signal'):
                with self.assertRaisesRegex(RuntimeError, 'Later Cosmic pointer'):
                    self.publish()
        self.assertEqual(pointer.read_bytes(), b'later pointer')

    def test_rollback_refuses_later_pointer_host_or_unrelated_module(self):
        self.publish()
        pointer = self.modules / GAME / 'active.json'
        original_pointer = pointer.read_bytes()
        pointer.write_bytes(b'later pointer')
        with self.assertRaisesRegex(RuntimeError, 'Unrelated module'):
            self.helper.rollback()
        pointer.write_bytes(original_pointer)
        host = self.state / 'host.json'
        original_host = host.read_bytes()
        host.write_bytes(original_host + b'\n')
        with self.assertRaisesRegex(RuntimeError, 'moduleHostContract'):
            self.helper.rollback()
        host.write_bytes(original_host)
        (self.modules / 'unreviewed.txt').write_bytes(b'later file')
        with self.assertRaisesRegex(RuntimeError, 'Unrelated module'):
            self.helper.rollback()

    def test_rollback_refuses_changed_application(self):
        self.publish()
        current = self.snapshot()
        current['container']['id'] = 'later game'
        self.helper.snapshot = lambda: current
        with self.assertRaisesRegex(RuntimeError, 'Running application changed'):
            self.helper.rollback()

    def test_backup_host_is_checked_before_pointer_recovery(self):
        self.publish()
        (self.backup / 'module-host.json').write_bytes(b'changed host backup')
        pointer = (self.modules / GAME / 'active.json').read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'host backup differs'):
            self.helper.rollback()
        self.assertEqual((self.modules / GAME / 'active.json').read_bytes(), pointer)

    def test_direct_recovery_uses_compare_and_swap_for_owned_pointer(self):
        installer, metadata, _result = self.helper.check()
        self.helper.backup(metadata)
        pointer = self.modules / GAME / 'active.json'
        pointer.write_bytes(b'later pointer from another publication')
        with self.assertRaisesRegex(RuntimeError, 'Later Cosmic pointer'):
            self.helper.restore_pointer(installer, metadata)
        self.assertEqual(pointer.read_bytes(), b'later pointer from another publication')

    def test_rollback_without_saved_provenance_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Missing reviewed module backup'):
            self.helper.rollback()
        self.assertEqual((self.modules / GAME / 'active.json').read_bytes(), self.old_pointer)

    def test_retained_backup_provenance_cannot_be_rewritten(self):
        self.helper.backup(self.metadata)
        path = self.backup / 'cosmic-module-backup.json'
        record = json.loads(path.read_text())
        record['sourceCommit'] = 'd' * 40
        save_json(path, record)
        with self.assertRaisesRegex(RuntimeError, 'provenance differs'):
            self.helper.backup(self.metadata)
        self.assertEqual(json.loads(path.read_text())['sourceCommit'], 'd' * 40)

    def test_check_fails_if_installed_host_bytes_change(self):
        host = self.state / 'host.json'
        host.write_bytes(host.read_bytes() + b'\n')
        with self.assertRaisesRegex(RuntimeError, 'moduleHostContract'):
            self.helper.check()

    def test_main_holds_all_three_locks_in_order_before_check(self):
        helper = self.helper
        themed = self.root.parent / 'themed-publish.lock'
        events = []
        def path(value):
            return themed if str(value) == '/opt/royal-releases/themed-publish.lock' else Path(value)
        def flock(descriptor, operation):
            self.assertEqual(operation, helper.fcntl.LOCK_EX | helper.fcntl.LOCK_NB)
            events.append(('lock', descriptor.fileno(), descriptor.name))
        def checked():
            self.assertEqual(len(events), 3)
            self.assertEqual([value[2] for value in events],
                             [str(themed), str(self.live / '.client-presentation-deploy.lock'), str(self.state / 'module.lock')])
            for _label, descriptor, _name in events:
                self.assertGreaterEqual(descriptor, 0)
            events.append(('check',))
            return None, None, {'verified': True}
        with patch.object(helper, 'Path', side_effect=path), patch.object(helper.fcntl, 'flock', side_effect=flock), \
             patch.object(helper.signal, 'signal'), patch.object(helper, 'check', side_effect=checked), \
             patch.object(helper.sys, 'argv', ['modules.py', 'check']), patch.object(helper.sys, 'stdout', io.StringIO()):
            helper.main()
        self.assertEqual(events[-1], ('check',))

    def test_lock_contention_stops_before_module_check(self):
        helper = self.helper
        themed = self.root.parent / 'themed-publish.lock'
        def path(value):
            return themed if str(value) == '/opt/royal-releases/themed-publish.lock' else Path(value)
        with patch.object(helper, 'Path', side_effect=path), \
             patch.object(helper.fcntl, 'flock', side_effect=[None, BlockingIOError('another publisher')]), \
             patch.object(helper, 'check') as checked, patch.object(helper.sys, 'argv', ['modules.py', 'check']):
            with self.assertRaises(BlockingIOError):
                helper.main()
        checked.assert_not_called()

    def test_failure_recovery_refuses_later_application_before_touching_pointer(self):
        installer, metadata, _result = self.helper.check()
        original = installer.run
        def install_then_change_app(args):
            result = original(args)
            if args.operation == 'install':
                self.after['container']['id'] = 'later game'
                raise RuntimeError('interrupted after another application change')
            return result
        installer.run = install_then_change_app
        with patch.object(self.helper, 'load_installer', return_value=installer), patch.object(self.helper.signal, 'signal'):
            with self.assertRaisesRegex(RuntimeError, 'Running application changed'):
                self.publish()
        self.assertEqual(sha((self.modules / GAME / 'active.json').read_bytes()), self.helper.installed_sha(metadata))


if __name__ == '__main__':
    unittest.main()
