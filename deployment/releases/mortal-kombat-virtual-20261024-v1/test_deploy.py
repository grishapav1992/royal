"""Verify release isolation and recovery without Docker or production access."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import shutil
import tarfile
import tempfile
import unittest
import sys
from types import SimpleNamespace

try:
    import fcntl
except ImportError:
    # The guarded filesystem tests never execute the Linux-only lock entrypoint.
    sys.modules['fcntl'] = SimpleNamespace(LOCK_EX=2, LOCK_NB=4)

HERE = Path(__file__).resolve().parent
sha = lambda value: hashlib.sha256(value).hexdigest()


class ChatReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name).resolve()
        shutil.copy2(HERE / 'deploy.py', root / 'deploy.py')
        self.original = {'src/ui/SocialUI.ts': b'old UI', 'server/LobbyRoom.ts': b'old room',
                         'server/LobbyRoom.ts.orig': b'historical source'}
        old_image = 'sha256:' + 'a' * 64
        before = {
            'source': {name: sha(value) for name, value in self.original.items()},
            'program': {
                'dist/index.html': sha(b'old index'), 'dist/assets/index-old.js': sha(b'old client'),
                'dist/assets/index-old.css': sha(b'old CSS'), 'dist-server/index.js': sha(b'old backend'),
                'dist-server/crypto-reconcile.js': sha(b'crypto program'), 'dist-server/payments.js': sha(b'payment program'),
                'module-dist/studio-example/active.json': sha(b'baseline pointer'),
                'module-dist/studio-example/versions/1.0.0-aaaaaaaaaaaa/entry.js': sha(b'baseline entry'),
                'package.json': sha(b'package metadata'), 'package-lock.json': sha(b'dependency lock'),
            },
            'configHashes': {'.env': sha(b'private settings'), 'compose.yaml': sha(b'compose settings')},
            'moduleFiles': {'/opt/royal-game-modules/studio-dracona/active.json': sha(b'retained pointer')},
            'moduleHostContract': sha(b'installed contract'),
            'realMoneyFlags': {'exampleFlag': 'false'},
            'services': {'/royal-game-1': {'id': 'old game'}, '/royal-payments-1': {'id': 'payment service'}},
            'container': {'id': 'old game', 'image': old_image, 'health': 'healthy', 'startedAt': 'old start',
                          'mounts': [{'Destination': '/app/data', 'Name': 'game_data'}], 'host': {'Memory': 1},
                          'runtimeHash': sha(b'runtime settings'), 'composeFiles': 'compose.yaml'},
            'preparedImage': old_image,
        }
        before['preparedProgram'] = copy.deepcopy(before['program'])
        manifest = {'release': 'mortal-kombat-virtual-20261024-v1', 'sourceCommit': 'c' * 40, 'before': before,
                    'changed': {'src/ui/SocialUI.ts': sha(b'new UI'), 'server/chatQueue.ts': sha(b'new queue')},
                    'delta': {'index.html': sha(b'new index'), 'assets/index-new.js': sha(b'new client')},
                    'serverDelta': {'index.js': sha(b'new backend')},
                    'helperSha256': 'd' * 64, 'snapshotSha256': 'd' * 64}
        (root / 'install-manifest.json').write_text(json.dumps(manifest))
        spec = importlib.util.spec_from_file_location('chat_release_under_test', root / 'deploy.py')
        self.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.helper)
        helper = self.helper
        helper.LIVE = root / 'live'
        helper.BACKUP = root / 'backup'
        helper.LIVE.mkdir()
        for name, value in self.original.items():
            target = helper.LIVE / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value)
        self.built = {'image': 'sha256:' + 'b' * 64, 'program': helper.expected_program()}

    def published(self):
        helper = self.helper
        state = copy.deepcopy(helper.OLD)
        state['source'].update(helper.CHANGES)
        state['container']['image'] = state['preparedImage'] = self.built['image']
        state['container']['id'] = 'new game'
        state['services']['/royal-game-1']['id'] = 'new game'
        state['program'] = copy.deepcopy(self.built['program'])
        return state

    def backups(self):
        helper = self.helper
        helper.BACKUP.mkdir()
        with tarfile.open(helper.BACKUP / 'source.tgz', 'w:gz') as archive:
            for name in helper.OLD['source']:
                archive.add(helper.LIVE / name, arcname=name, recursive=False)
        (helper.BACKUP / 'index.html').write_bytes(b'old index')
        self.built['sourceBackupSha256'] = helper.sha(helper.BACKUP / 'source.tgz')

    def enable_payload_fixture(self):
        helper = self.helper
        helper.ROOT = Path('/opt/royal-releases/mortal-kombat-virtual-20261024-v1')
        helper.sha = lambda _path: 'd' * 64
        helper.inventory = lambda path: {'source': helper.CHANGES, 'dist-delta': helper.DELTA,
                                         'server-delta': helper.SERVER_DELTA,'metadata':helper.M.get('runtimePackages',{})}[path.name]

    def test_exact_backup_can_be_linked_and_survives_removing_the_original_name(self):
        h = self.helper
        self.backups()
        candidate = h.BACKUP / 'source.tgz'
        self.assertEqual(h.reusable_source_backup(candidate), candidate)
        linked = h.BACKUP / 'linked.tgz'
        h.os.link(candidate, linked, follow_symlinks=False)
        candidate.unlink()
        h.verify_tar(linked)

    def test_backup_reuse_rejects_missing_modified_and_symlinked_archives(self):
        h = self.helper
        self.assertIsNone(h.reusable_source_backup(h.BACKUP / 'missing.tgz'))
        self.backups()
        candidate = h.BACKUP / 'source.tgz'
        link = h.BACKUP / 'symlink.tgz'
        link.symlink_to(candidate)
        self.assertIsNone(h.reusable_source_backup(link))
        h.OLD['source']['src/ui/SocialUI.ts'] = sha(b'different source')
        self.assertIsNone(h.reusable_source_backup(candidate))

    def test_wallet_backup_stream_keeps_exact_bytes_and_caps_disk_allocation(self):
        h = self.helper
        output = h.LIVE / 'wallet.dump'
        h.bounded_dump([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(bytes(range(128)))'], output, 128)
        self.assertEqual(output.read_bytes(), bytes(range(128)))
        output.unlink()
        with self.assertRaisesRegex(RuntimeError, 'exceeds reserved capacity'):
            h.bounded_dump([sys.executable, '-c', 'print("x"*1000000)'], output, 128)
        self.assertFalse(output.exists())

    def test_wallet_backup_failure_never_leaves_a_valid_looking_dump(self):
        h = self.helper
        output = h.LIVE / 'wallet.dump'
        with self.assertRaisesRegex(RuntimeError, 'backup command failed'):
            h.bounded_dump([sys.executable, '-c', 'import sys;print("partial");sys.exit(1)'], output, 128)
        self.assertFalse(output.exists())

    def test_overlay_preserves_payment_crypto_dependencies_and_all_bundled_modules(self):
        helper = self.helper
        result = helper.expected_program()
        for name, value in helper.OLD['program'].items():
            if name not in {'dist/index.html', 'dist-server/index.js'}:
                self.assertEqual(result[name], value, name)
        self.assertEqual(result['dist-server/index.js'], helper.SERVER_DELTA['index.js'])
        self.assertEqual(set(result) - set(helper.OLD['program']), {'dist/assets/index-new.js'})

    def test_payload_accepts_only_the_main_backend_bundle(self):
        self.enable_payload_fixture()
        self.helper.payload()
        self.helper.SERVER_DELTA['payments.js'] = sha(b'unreviewed payment program')
        with self.assertRaisesRegex(RuntimeError, 'Only the main backend bundle'):
            self.helper.payload()

    def test_payload_refuses_new_game_assets(self):
        self.enable_payload_fixture()
        self.helper.DELTA['assets/example.webp'] = sha(b'new artwork')
        with self.assertRaisesRegex(RuntimeError, 'Only the client index'):
            self.helper.payload()

    def test_new_combat_assets_are_allowed_but_existing_urls_are_immutable(self):
        self.enable_payload_fixture()
        h=self.helper
        h.CHANGES['games/mortal-kombat/CombatUI.ts']=sha(b'combat client')
        name='assets/mortal-kombat/arenas/0/arena.png'
        h.DELTA[name]=sha(b'new combat arena')
        h.payload()
        h.OLD['program']['dist/'+name]=sha(b'old immutable arena')
        with self.assertRaisesRegex(RuntimeError,'Existing asset URL'):
            h.payload()

    def test_combat_asset_path_cannot_escape_the_payload(self):
        self.enable_payload_fixture()
        self.helper.DELTA['assets/mortal-kombat/../../outside.png']=sha(b'escape')
        with self.assertRaisesRegex(RuntimeError,'Unsafe release path'):
            self.helper.payload()

    def test_only_the_combat_contract_can_be_added(self):
        spec=importlib.util.spec_from_file_location('combat_modules',HERE/'modules.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        old={'apiVersion':1,'games':{'retained':{'apiVersion':1,'rulesVersion':3,'progressVersion':2}}}
        new=copy.deepcopy(old);new['games']['mortal-kombat']={'apiVersion':1,'rulesVersion':2,'progressVersion':1}
        module.contracts(old,new)
        new['games']['retained']['rulesVersion']=4
        with self.assertRaises(AssertionError):module.contracts(old,new)

    def test_workflow_metadata_is_copied_exactly_and_cannot_add_a_dependency_lock(self):
        self.enable_payload_fixture();h=self.helper
        h.M['runtimePackages']={'package.json':sha(b'new workflow scripts')}
        h.CHANGES['package.json']=h.M['runtimePackages']['package.json']
        h.payload()
        self.assertEqual(h.expected_program()['package.json'],h.M['runtimePackages']['package.json'])
        h.M['runtimePackages']['package-lock.json']=sha(b'changed dependencies')
        with self.assertRaisesRegex(RuntimeError,'Unexpected runtime metadata'):h.payload()

    def test_payload_refuses_historical_source_changes(self):
        self.enable_payload_fixture()
        self.helper.CHANGES['server/LobbyRoom.ts.orig'] = sha(b'changed history')
        with self.assertRaisesRegex(RuntimeError, 'Historical source backups'):
            self.helper.payload()

    def test_unchanged_or_partially_published_sources_can_recover(self):
        helper = self.helper
        helper.recovery_guard(copy.deepcopy(helper.OLD), self.built)
        partial = self.published()
        partial['source']['src/ui/SocialUI.ts'] = helper.BASE['src/ui/SocialUI.ts']
        helper.recovery_guard(partial, self.built)

    def test_missing_failed_game_container_can_recover(self):
        state = self.published()
        state['container'] = None
        state['program'] = None
        state['realMoneyFlags'] = None
        state['services'].pop('/royal-game-1')
        self.helper.recovery_guard(state, self.built)

    def test_later_image_prevents_recovery(self):
        state = self.published()
        state['container']['image'] = 'sha256:' + 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'Later image'):
            self.helper.recovery_guard(state, self.built)

    def test_later_source_change_prevents_recovery(self):
        state = self.published()
        state['source']['server/LobbyRoom.ts'] = sha(b'newer room change')
        with self.assertRaisesRegex(RuntimeError, 'Later source prevents'):
            self.helper.recovery_guard(state, self.built)

    def test_unrelated_source_addition_prevents_recovery(self):
        state = self.published()
        state['source']['server/unrelated.ts'] = sha(b'newer unrelated source')
        with self.assertRaisesRegex(RuntimeError, 'Later source inventory'):
            self.helper.recovery_guard(state, self.built)

    def test_changed_game_pointer_prevents_recovery(self):
        state = self.published()
        state['moduleFiles']['/opt/royal-game-modules/studio-dracona/active.json'] = sha(b'newer pointer')
        with self.assertRaisesRegex(RuntimeError, 'moduleFiles'):
            self.helper.recovery_guard(state, self.built)

    def test_changed_private_contract_or_configuration_prevents_recovery(self):
        for key in ['moduleHostContract', 'configHashes']:
            state = self.published()
            state[key] = 'changed'
            with self.assertRaisesRegex(RuntimeError, key):
                self.helper.recovery_guard(state, self.built)

    def test_changed_other_service_or_mount_prevents_recovery(self):
        state = self.published()
        state['services']['/royal-payments-1']['id'] = 'newer payment service'
        with self.assertRaisesRegex(RuntimeError, 'Another persistent service'):
            self.helper.recovery_guard(state, self.built)
        state = self.published()
        state['container']['mounts'] = []
        with self.assertRaisesRegex(RuntimeError, 'mounts'):
            self.helper.recovery_guard(state, self.built)

    def test_readable_runtime_drift_prevents_recovery(self):
        for name in ['dist-server/index.js', 'dist-server/payments.js', 'dist/assets/index-old.js']:
            state = self.published()
            state['program'][name] = sha(b'newer runtime bytes')
            with self.assertRaisesRegex(RuntimeError, 'Later running files'):
                self.helper.recovery_guard(state, self.built)

    def test_complete_source_backup_includes_historical_file_and_detects_tampering(self):
        self.backups()
        self.helper.backup_guard(self.built)
        with (self.helper.BACKUP / 'source.tgz').open('ab') as output:
            output.write(b'tampered archive')
        with self.assertRaisesRegex(RuntimeError, 'Source backup changed'):
            self.helper.backup_guard(self.built)

    def test_changed_index_backup_is_rejected(self):
        self.backups()
        (self.helper.BACKUP / 'index.html').write_bytes(b'changed backup index')
        with self.assertRaisesRegex(RuntimeError, 'Client index backup changed'):
            self.helper.backup_guard(self.built)

    @unittest.skipIf(sys.platform=='win32', 'Atomic Linux directory fsync is verified on the deployment host')
    def test_rollback_restores_sources_and_index_without_other_runtime_actions(self):
        helper = self.helper
        self.backups()
        current = self.published()
        changed_bytes = {'src/ui/SocialUI.ts': b'new UI', 'server/chatQueue.ts': b'new queue'}
        for name, value in changed_bytes.items():
            target = helper.LIVE / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value)
        (helper.ROOT / 'build-result.json').write_text(json.dumps(self.built))
        actions = []
        helper.payload = lambda: None
        helper.snapshot = lambda recovery=False: copy.deepcopy(current if recovery else helper.OLD)
        helper.run = lambda args, **_kwargs: actions.append(args) or (json.dumps(current['program']) if args[:2] == ['docker', 'exec'] else '')
        helper.compose = lambda: actions.append(['compose-game-only'])
        helper.healthy = lambda: actions.append(['health-read-only'])
        result = helper.rollback()
        self.assertFalse(result['databaseTouched'])
        self.assertEqual((helper.LIVE / 'src/ui/SocialUI.ts').read_bytes(), self.original['src/ui/SocialUI.ts'])
        self.assertFalse((helper.LIVE / 'server/chatQueue.ts').exists())
        self.assertEqual((helper.LIVE / 'server/LobbyRoom.ts.orig').read_bytes(), self.original['server/LobbyRoom.ts.orig'])
        self.assertEqual((helper.LIVE / 'dist/index.html').read_bytes(), b'old index')
        self.assertEqual([action[:2] for action in actions], [['docker', 'exec'], ['docker', 'exec'], ['docker', 'tag'], ['compose-game-only'], ['health-read-only']])


if __name__ == '__main__':
    unittest.main()

