"""Verify release isolation and recovery without Docker or production access."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import io
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import sys
from types import SimpleNamespace

try:
    import fcntl
except ImportError:
    # These filesystem tests do not execute the Linux publication entrypoint.
    sys.modules['fcntl'] = SimpleNamespace(LOCK_EX=2, LOCK_NB=4)

HERE = Path(__file__).resolve().parent
sha = lambda value: hashlib.sha256(value).hexdigest()


class CosmicOriginReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name).resolve()
        shutil.copy2(HERE / 'deploy.py', root / 'deploy.py')
        shutil.copy2(HERE / 'quiesce.cjs', root / 'quiesce.cjs')
        self.original = {'src/ui/SocialUI.ts': b'old UI', 'server/LobbyRoom.ts': b'old room',
                         'server/LobbyRoom.ts.orig': b'historical source'}
        self.original.update({name: ('preserved ' + name).encode() for name in [
            'server/database.ts', 'server/combatGame.ts', 'server/combatRoom.ts', 'server/combatGuard.ts',
            'server/commonCombatWallet.ts', 'server/pvp/virtual-wallet.ts', 'server/finance/combat-escrow.ts',
            'server/finance/pvp-money.ts', 'src/shared/combat.ts', 'src/shared/combatEscrow.ts', 'src/shared/pvp.ts']})
        old_image = 'sha256:' + 'a' * 64
        before = {
            'source': {name: sha(value) for name, value in self.original.items()},
            'program': {
                'dist/index.html': sha(b'old index'), 'dist/assets/index-old.js': sha(b'old client'),
                'dist/assets/index-old.css': sha(b'old CSS'), 'dist-server/index.js': sha(b'old compatible virtual backend'),
                'dist/assets/atelier-old.js': sha(b'installed fitting room'),
                'dist-server/crypto-reconcile.js': sha(b'crypto program'), 'dist-server/payments.js': sha(b'payment program'),
                'module-dist/studio-example/active.json': sha(b'baseline pointer'),
                'module-dist/studio-example/versions/1.0.0-aaaaaaaaaaaa/entry.js': sha(b'baseline entry'),
                'package.json': sha(b'package metadata'), 'package-lock.json': sha(b'dependency lock'),
            },
            'configHashes': {'.env': sha(b'private settings'), 'compose.yaml': sha(b'compose settings')},
            'moduleFiles': {'/opt/royal-game-modules/studio-dracona/active.json': sha(b'retained pointer')},
            'moduleHostContract': sha(b'installed contract'),
            'moduleHost': {'games': {'mortal-kombat': {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 1}}},
            'realMoneyFlags': {'exampleFlag': 'false'},
            'services': {'/royal-game-1': {'id': 'old game'}, '/royal-payments-1': {'id': 'payment service'}},
            'container': {'id': 'old game', 'image': old_image, 'health': 'healthy', 'startedAt': 'old start',
                          'mounts': [{'Destination': '/app/data', 'Name': 'game_data'}], 'host': {'Memory': 1},
                          'runtimeHash': sha(b'runtime settings'), 'composeFiles': 'compose.yaml'},
            'preparedImage': old_image,
        }
        before['preparedProgram'] = copy.deepcopy(before['program'])
        manifest = {'release': 'cosmic-origin-20261026-v1', 'sourceCommit': 'c' * 40, 'before': before,
                    'changed': {'src/ui/SocialUI.ts': sha(b'new UI'), 'server/chatQueue.ts': sha(b'new queue')},
                    'delta': {'index.html': sha(b'new index'), 'assets/index-new.js': sha(b'new client')},
                    'serverDelta': {'index.js': sha(b'new origin guard backend')},
                    'helperSha256': 'd' * 64, 'snapshotSha256': 'd' * 64, 'quiesceSha256': 'd' * 64}
        (root / 'install-manifest.json').write_text(json.dumps(manifest))
        spec = importlib.util.spec_from_file_location('cosmic_origin_release_under_test', root / 'deploy.py')
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
        state['preparedProgram'] = copy.deepcopy(self.built['program'])
        return state

    def recovery_module_fixture(self, old_pointer=True):
        helper = self.helper
        pointer = '/opt/royal-game-modules/studio-cosmic-escape/active.json'
        if old_pointer:
            helper.OLD['moduleFiles'][pointer] = sha(b'prior Cosmic pointer')
        version = '1.0.0-123456789abc'
        prefix = 'studio-cosmic-escape/versions/' + version + '/'
        helper.M['modulePackages'] = [{'gameId': 'studio-cosmic-escape', 'version': version,
                                       'beforeSha256': helper.OLD['moduleFiles'].get(pointer, 'none')}]
        helper.M['moduleDelta'] = {prefix + 'manifest.json': sha(b'new manifest'),
                                   prefix + 'entry-1234567890abcdef.js': sha(b'new client')}
        additions = {'/opt/royal-game-modules/' + name: digest for name, digest in helper.M['moduleDelta'].items()}
        return pointer, prefix, additions

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
        helper.ROOT = Path('/opt/royal-releases/cosmic-origin-20261026-v1')
        helper.sha = lambda _path: 'd' * 64
        helper.inventory = lambda path: {'source': helper.CHANGES, 'dist-delta': helper.DELTA,
                                         'server-delta': helper.SERVER_DELTA, 'metadata': helper.RUNTIME_PACKAGES}[path.name]

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

    def test_payload_refuses_an_empty_or_invalid_backend(self):
        self.enable_payload_fixture()
        helper = self.helper
        helper.SERVER_DELTA.clear()
        with self.assertRaisesRegex(RuntimeError, 'Only the main backend bundle'):
            helper.payload()
        helper.SERVER_DELTA['index.js'] = 'invalid'
        with self.assertRaisesRegex(RuntimeError, 'Invalid backend digest'):
            helper.payload()

    def test_existing_asset_url_and_admin_page_are_preserved(self):
        self.enable_payload_fixture()
        helper = self.helper
        helper.DELTA['assets/index-old.js'] = sha(b'overwritten old URL')
        with self.assertRaisesRegex(RuntimeError, 'Existing asset URL would change'):
            helper.payload()
        del helper.DELTA['assets/index-old.js']
        helper.DELTA['admin.html'] = sha(b'unreviewed admin')
        with self.assertRaisesRegex(RuntimeError, 'Only the client index'):
            helper.payload()

    def test_optional_runtime_metadata_only_allows_the_same_source_package(self):
        self.enable_payload_fixture()
        helper = self.helper
        helper.RUNTIME_PACKAGES['package.json'] = sha(b'reviewed workflow metadata')
        helper.CHANGES['package.json'] = helper.RUNTIME_PACKAGES['package.json']
        helper.payload()
        self.assertEqual(helper.expected_program()['package.json'], helper.CHANGES['package.json'])
        helper.RUNTIME_PACKAGES['package-lock.json'] = sha(b'unreviewed dependencies')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected runtime metadata'):
            helper.payload()

    def test_runtime_metadata_cannot_differ_from_reviewed_source(self):
        self.enable_payload_fixture()
        self.helper.RUNTIME_PACKAGES['package.json'] = sha(b'unmatched metadata')
        with self.assertRaisesRegex(RuntimeError, 'Runtime metadata differs from source'):
            self.helper.payload()

    def test_payload_refuses_new_game_assets(self):
        self.enable_payload_fixture()
        self.helper.DELTA['assets/example.webp'] = sha(b'new artwork')
        with self.assertRaisesRegex(RuntimeError, 'Only the client index'):
            self.helper.payload()

    def test_payload_refuses_historical_source_changes(self):
        self.enable_payload_fixture()
        self.helper.CHANGES['server/LobbyRoom.ts.orig'] = sha(b'changed history')
        with self.assertRaisesRegex(RuntimeError, 'Historical source backups'):
            self.helper.payload()

    def test_payload_refuses_changed_wallet_sources_or_combat_contract(self):
        self.enable_payload_fixture()
        helper = self.helper
        for name in helper.WALLET_SOURCES:
            helper.CHANGES[name] = sha(b'changed accepted wallet rule')
            with self.assertRaisesRegex(RuntimeError, 'Wallet or fight rules must remain unchanged'):
                helper.payload()
            del helper.CHANGES[name]
        helper.OLD['moduleHost']['games']['mortal-kombat']['rulesVersion'] = 1
        with self.assertRaisesRegex(RuntimeError, 'same virtual combat contract'):
            helper.payload()

    def test_payload_refuses_tampered_financial_gate_digest(self):
        self.enable_payload_fixture()
        self.helper.sha = lambda path: 'e' * 64 if path.name == 'quiesce.cjs' else 'd' * 64
        with self.assertRaisesRegex(RuntimeError, 'Financial gate helper changed'):
            self.helper.payload()

    def test_gate_rechecks_its_real_bytes_before_starting_a_process(self):
        helper = self.helper
        helper.M['quiesceSha256'] = helper.sha(helper.ROOT / 'quiesce.cjs')
        (helper.ROOT / 'quiesce.cjs').write_text('tampered gate')
        with patch.object(helper.subprocess, 'Popen') as process:
            with self.assertRaisesRegex(RuntimeError, 'Financial gate helper changed'):
                helper.quiet_gate()
        process.assert_not_called()

    def publish_fixture(self):
        helper = self.helper
        actions = []
        (helper.ROOT / 'build-result.json').write_text(json.dumps(self.built))
        (helper.ROOT / 'dist-delta').mkdir()
        helper.payload = lambda: None
        helper.baseline = lambda: copy.deepcopy(helper.OLD)
        helper.publication_reserve = lambda: 0
        helper.image = lambda _ref: self.built['image']
        helper.snapshot = lambda recovery=False: self.published()
        helper.atomic = lambda *_args: actions.append('source')
        helper.run = lambda *_args, **_kwargs: actions.append('tag')
        helper.compose = lambda: actions.append('compose')
        helper.healthy = lambda: actions.append('healthy')
        helper.rollback = lambda: actions.append('rollback')
        gate = (SimpleNamespace(poll=lambda: None), None)
        helper.quiet_gate = lambda: actions.append('quiet') or gate
        helper.release_gate = lambda _gate: actions.append('release')
        return actions, gate

    def test_refused_quiet_gate_cannot_mutate_sources_runtime_or_start_rollback(self):
        actions, _gate = self.publish_fixture()
        def refused():
            raise RuntimeError('Paid matches remain active')
        self.helper.quiet_gate = refused
        with self.assertRaisesRegex(RuntimeError, 'Paid matches remain active'):
            self.helper.publish()
        self.assertEqual(actions, [])
        for name, content in self.original.items():
            self.assertEqual((self.helper.LIVE / name).read_bytes(), content)
        self.assertFalse((self.helper.ROOT / 'publication-failed.json').exists())

    def test_gate_spans_source_and_compose_and_releases_before_health(self):
        actions, _gate = self.publish_fixture()
        with patch.object(self.helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=10 * 1024**3)):
            result = self.helper.publish()
        self.assertTrue(result['published'])
        self.assertEqual(actions, ['quiet', 'source', 'source', 'tag', 'compose', 'release', 'healthy'])

    def test_compose_failure_releases_gate_before_rollback(self):
        actions, _gate = self.publish_fixture()
        def failed_compose():
            actions.append('compose')
            raise RuntimeError('compose failed')
        self.helper.compose = failed_compose
        with patch.object(self.helper.signal, 'signal'):
            with self.assertRaisesRegex(RuntimeError, 'compose failed'):
                self.helper.publish()
        self.assertEqual(actions, ['quiet', 'source', 'source', 'tag', 'compose', 'release', 'rollback'])
        self.assertFalse((self.helper.ROOT / 'published.json').exists())

    def test_expired_gate_blocks_source_mutation_and_compose(self):
        actions, gate = self.publish_fixture()
        gate[0].poll = lambda: 1
        with patch.object(self.helper.signal, 'signal'):
            with self.assertRaisesRegex(RuntimeError, 'Financial gate expired'):
                self.helper.publish()
        self.assertEqual(actions, ['quiet', 'release', 'rollback'])

    def test_gate_expiry_between_sources_prevents_restart(self):
        actions, gate = self.publish_fixture()
        def copied(*_args):
            actions.append('source')
            gate[0].poll = lambda: 1
        self.helper.atomic = copied
        with patch.object(self.helper.signal, 'signal'):
            with self.assertRaisesRegex(RuntimeError, 'Financial gate expired'):
                self.helper.publish()
        self.assertEqual(actions, ['quiet', 'source', 'release', 'rollback'])

    def test_failed_gate_release_cannot_record_success_or_run_health(self):
        actions, _gate = self.publish_fixture()
        def failed_release(_gate):
            actions.append('release')
            raise RuntimeError('Financial gate release failed')
        self.helper.release_gate = failed_release
        with patch.object(self.helper.signal, 'signal'):
            with self.assertRaisesRegex(RuntimeError, 'Financial gate release failed'):
                self.helper.publish()
        self.assertEqual(actions, ['quiet', 'source', 'source', 'tag', 'compose', 'release', 'rollback'])
        self.assertFalse((self.helper.ROOT / 'published.json').exists())

    def test_release_gate_refuses_an_expired_process_and_closes_resources(self):
        helper = self.helper
        process = SimpleNamespace(poll=lambda: 1, stdin=io.StringIO(), stdout=io.StringIO())
        log = io.StringIO()
        with self.assertRaisesRegex(RuntimeError, 'Financial gate expired'):
            helper.release_gate((process, log))
        self.assertTrue(process.stdout.closed)
        self.assertTrue(log.closed)

    def test_release_gate_checks_successful_commit(self):
        helper = self.helper
        events = []
        class Input(io.StringIO):
            def write(self, value):
                events.append(value)
                return super().write(value)
        code = [None]
        def waited(timeout=None):
            self.assertEqual(timeout, 10)
            code[0] = 0
            return 0
        process = SimpleNamespace(poll=lambda: code[0], wait=waited, stdin=Input(), stdout=io.StringIO())
        log = io.StringIO()
        helper.release_gate((process, log))
        self.assertEqual(events, ['release\n'])
        self.assertTrue(process.stdin.closed and process.stdout.closed and log.closed)

    def test_unchanged_or_partially_published_sources_can_recover(self):
        helper = self.helper
        helper.recovery_guard(copy.deepcopy(helper.OLD), self.built)
        partial = self.published()
        partial['source']['src/ui/SocialUI.ts'] = helper.BASE['src/ui/SocialUI.ts']
        helper.recovery_guard(partial, self.built)

    def test_baseline_refuses_source_runtime_image_or_container_drift(self):
        helper = self.helper
        for mutate in [
            lambda row: row['source'].update({'server/unreviewed.ts': sha(b'later source')}),
            lambda row: row['program'].update({'dist/assets/atelier-old.js': sha(b'later fitting room')}),
            lambda row: row.update({'preparedImage': 'sha256:' + 'f' * 64}),
            lambda row: row['container'].update({'id': 'another game container'}),
        ]:
            state = copy.deepcopy(helper.OLD)
            mutate(state)
            helper.snapshot = lambda: state
            with self.assertRaises(RuntimeError):
                helper.baseline()

    def test_baseline_requires_running_files_to_match_prepared_image(self):
        helper = self.helper
        helper.OLD['preparedProgram']['dist/assets/atelier-old.js'] = sha(b'unexpected image bytes')
        helper.snapshot = lambda: copy.deepcopy(helper.OLD)
        with self.assertRaisesRegex(RuntimeError, 'Prepared image does not match'):
            helper.baseline()

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

    def test_known_cosmic_files_are_allowed_only_during_recovery_after_old_pointer_restore(self):
        _, _, additions = self.recovery_module_fixture()
        state = self.published()
        state['moduleFiles'].update(additions)
        self.helper.recovery_guard(state, self.built)
        with self.assertRaisesRegex(RuntimeError, 'moduleFiles'):
            self.helper.settings(state)

    def test_recovery_accepts_known_partial_additions_and_original_pointer_absence(self):
        pointer, _, additions = self.recovery_module_fixture(old_pointer=False)
        state = self.published()
        name, digest = next(iter(additions.items()))
        state['moduleFiles'][name] = digest
        self.helper.recovery_guard(state, self.built)
        state['moduleFiles'][pointer] = sha(b'new pointer not restored')
        with self.assertRaisesRegex(RuntimeError, 'moduleFiles'):
            self.helper.recovery_guard(state, self.built)

    def test_recovery_additions_do_not_allow_changed_old_pointer_old_file_or_contract(self):
        pointer, _, additions = self.recovery_module_fixture()
        for mutate in [
            lambda row: row['moduleFiles'].update({pointer: sha(b'later Cosmic pointer')}),
            lambda row: row['moduleFiles'].update({'/opt/royal-game-modules/studio-dracona/active.json': sha(b'later other pointer')}),
            lambda row: row.update({'moduleHostContract': sha(b'changed host contract')}),
        ]:
            state = self.published()
            state['moduleFiles'].update(additions)
            mutate(state)
            with self.assertRaisesRegex(RuntimeError, 'moduleFiles|moduleHostContract'):
                self.helper.recovery_guard(state, self.built)

    def test_recovery_rejects_unrelated_added_file_or_wrong_cosmic_hash(self):
        _, prefix, additions = self.recovery_module_fixture()
        for name, digest in [
            ('/opt/royal-game-modules/studio-dracona/versions/1.0.0-123456789abc/manifest.json', sha(b'unrelated')),
            ('/opt/royal-game-modules/' + prefix + 'unlisted.json', sha(b'unlisted')),
            ('/opt/royal-game-modules/' + prefix + 'unknown-null.json', None),
            (next(iter(additions)), sha(b'changed immutable bytes')),
        ]:
            state = self.published()
            state['moduleFiles'].update(additions)
            state['moduleFiles'][name] = digest
            with self.assertRaisesRegex(RuntimeError, 'moduleFiles'):
                self.helper.recovery_guard(state, self.built)

    def test_recovery_manifest_cannot_allow_other_game_version_pointer_or_unsafe_path(self):
        _, prefix, _ = self.recovery_module_fixture()
        for name in [
            'studio-dracona/versions/1.0.0-123456789abc/manifest.json',
            'studio-cosmic-escape/versions/1.0.0-ffffffffffff/manifest.json',
            'studio-cosmic-escape/active.json',
            prefix + '../manifest.json',
            prefix + 'common.js',
        ]:
            self.helper.M['moduleDelta'] = {name: sha(b'not allowed')}
            with self.assertRaisesRegex(RuntimeError, 'recovery module path|Unsafe release path'):
                self.helper.recovery_guard(self.published(), self.built)

    def test_recovery_requires_one_valid_cosmic_package_and_valid_digests(self):
        _, _, _ = self.recovery_module_fixture()
        package = copy.deepcopy(self.helper.M['modulePackages'][0])
        for packages in [[], [package, package], [{**package, 'gameId': 'studio-dracona'}],
                         [{**package, 'version': '../bad'}], [{**package, 'beforeSha256': sha(b'wrong baseline')}]]:
            self.helper.M['modulePackages'] = packages
            with self.assertRaises(RuntimeError):
                self.helper.recovery_guard(self.published(), self.built)
        self.helper.M['modulePackages'] = [package]
        name = next(iter(self.helper.M['moduleDelta']))
        self.helper.M['moduleDelta'][name] = 'invalid'
        with self.assertRaisesRegex(RuntimeError, 'Invalid recovery module digest'):
            self.helper.recovery_guard(self.published(), self.built)

    def test_recovery_allowlist_cannot_replace_preexisting_version_file(self):
        _, _, additions = self.recovery_module_fixture()
        name = next(iter(additions))
        self.helper.OLD['moduleFiles'][name] = sha(b'previous immutable file')
        with self.assertRaisesRegex(RuntimeError, 'replace an existing file'):
            self.helper.recovery_guard(self.published(), self.built)

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

    def test_changed_money_flags_prevents_recovery(self):
        state = self.published()
        state['realMoneyFlags']['exampleFlag'] = 'true'
        with self.assertRaisesRegex(RuntimeError, 'Money runtime flags changed'):
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

    def test_rollback_restores_sources_and_index_without_other_runtime_actions(self):
        self.assert_rollback()

    def test_full_app_rollback_keeps_known_immutable_cosmic_files_after_pointer_restore(self):
        _, _, additions = self.recovery_module_fixture()
        self.assert_rollback(additions)

    def assert_rollback(self, additions=None):
        helper = self.helper
        self.backups()
        current = self.published()
        after = copy.deepcopy(helper.OLD)
        current['moduleFiles'].update(additions or {})
        after['moduleFiles'].update(additions or {})
        changed_bytes = {'src/ui/SocialUI.ts': b'new UI', 'server/chatQueue.ts': b'new queue'}
        for name, value in changed_bytes.items():
            target = helper.LIVE / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value)
        (helper.ROOT / 'build-result.json').write_text(json.dumps(self.built))
        actions = []
        helper.payload = lambda: None
        helper.snapshot = lambda recovery=False: copy.deepcopy(current if recovery else after)
        helper.run = lambda args, **_kwargs: actions.append(args) or (json.dumps(current['program']) if args[:2] == ['docker', 'exec'] else '')
        helper.compose = lambda: actions.append(['compose-game-only'])
        helper.healthy = lambda: actions.append(['health-read-only'])
        helper.quiet_gate = lambda: actions.append(['quiet-gate']) or (SimpleNamespace(poll=lambda: None), None)
        helper.release_gate = lambda _gate: actions.append(['release-gate'])
        result = helper.rollback()
        self.assertFalse(result['databaseTouched'])
        self.assertEqual((helper.LIVE / 'src/ui/SocialUI.ts').read_bytes(), self.original['src/ui/SocialUI.ts'])
        self.assertFalse((helper.LIVE / 'server/chatQueue.ts').exists())
        self.assertEqual((helper.LIVE / 'server/LobbyRoom.ts.orig').read_bytes(), self.original['server/LobbyRoom.ts.orig'])
        self.assertEqual((helper.LIVE / 'dist/index.html').read_bytes(), b'old index')
        self.assertEqual([action[:2] for action in actions], [['docker', 'exec'], ['quiet-gate'], ['docker', 'tag'],
                         ['compose-game-only'], ['release-gate'], ['health-read-only']])


    def test_backup_budget_removes_partial_archive_without_touching_live_sources(self):
        self.helper.BACKUP.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'Source backup exceeds disk budget'):
            self.helper.backup_sources(16)
        self.assertFalse((self.helper.BACKUP / 'source.tgz').exists())
        for name, content in self.original.items():
            self.assertEqual((self.helper.LIVE / name).read_bytes(), content)

    def test_bounded_backup_preserves_complete_inventory(self):
        self.helper.BACKUP.mkdir()
        self.helper.backup_sources(100000)
        self.helper.verify_tar(self.helper.BACKUP / 'source.tgz')

    def test_build_budget_includes_backend_client_metadata_and_source_installation(self):
        helper = self.helper
        payload = {'dist-delta/index.html': b'a' * 17, 'dist-delta/assets/index-new.js': b'b' * 31,
                   'server-delta/index.js': b'c' * 2000, 'metadata/package.json': b'd' * 23}
        helper.RUNTIME_PACKAGES['package.json'] = sha(payload['metadata/package.json'])
        for name, content in payload.items():
            path = helper.ROOT / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        sources = {'src/ui/SocialUI.ts': b'new UI', 'server/chatQueue.ts': b'new queue'}
        for name, content in sources.items():
            path = helper.ROOT / 'source' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        self.assertEqual(helper.build_reserve(), 5 * 1024**3 + 3 * sum(map(len, payload.values()))
                         + sum(map(len, sources.values())) + 8 * 1024**2)
        self.assertEqual(helper.publication_reserve(), 5 * 1024**3 + sum(map(len, sources.values()))
                         + len(payload['dist-delta/index.html']) + len(payload['dist-delta/assets/index-new.js']) + 8 * 1024**2)

    def test_build_copies_only_exact_deltas_with_hardlinks(self):
        helper = self.helper
        helper.payload = lambda: None
        helper.baseline = lambda: {**helper.OLD, 'availableBytes': 20 * 1024**3}
        helper.build_reserve = lambda: 5 * 1024**3
        helper.image = lambda _ref: self.built['image']
        self.backups()
        helper.verify_existing_backup = lambda: None
        for folder, files in [('dist-delta', helper.DELTA), ('server-delta', helper.SERVER_DELTA)]:
            for name in files:
                path = helper.ROOT / folder / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes((folder + '/' + name).encode())
        base = {'Config': {'User': 'node'}, 'RootFS': {'Layers': ['base-layer']}}
        candidate = copy.deepcopy(base)
        candidate['Config']['Labels'] = {'org.opencontainers.image.revision': helper.M['sourceCommit']}
        candidate['RootFS']['Layers'].append('reviewed-overlay')
        def run(args, **_kwargs):
            if args[:2] == ['docker', 'run']:
                self.assertIn('--network=none', args)
                self.assertIn('--read-only', args)
                return json.dumps(helper.expected_program())
            if args[:3] == ['docker', 'image', 'inspect']:
                return json.dumps([base, candidate])
            self.fail('Unexpected external command: ' + repr(args))
        helper.run = run
        with patch.object(helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024**3)):
            with patch.object(helper.subprocess, 'run') as docker_build:
                result = helper.build()
                self.assertEqual(docker_build.call_count, 1)
                self.assertEqual(docker_build.call_args.args[0][:3], ['docker', 'build', '--pull=false'])
        context = helper.ROOT / 'runtime-context'
        for folder, files in [('dist-delta', helper.DELTA), ('server-delta', helper.SERVER_DELTA)]:
            for name in files:
                self.assertEqual((context / folder / name).stat().st_ino, (helper.ROOT / folder / name).stat().st_ino)
        dockerfile = (context / 'Dockerfile').read_text()
        self.assertIn('COPY --chown=node:node server-delta/index.js /app/dist-server/index.js\n', dockerfile)
        self.assertNotIn('npm', dockerfile)
        self.assertNotIn('module-dist', dockerfile)
        self.assertEqual(result['backendDeltaFiles'], 1)

    def test_build_refuses_unreviewed_candidate_image_files(self):
        helper = self.helper
        helper.payload = lambda: None
        helper.baseline = lambda: {**helper.OLD, 'availableBytes': 20 * 1024**3}
        helper.build_reserve = lambda: 5 * 1024**3
        self.backups()
        helper.verify_existing_backup = lambda: None
        for folder in ['dist-delta', 'server-delta']:
            (helper.ROOT / folder).mkdir()
        helper.image = lambda _ref: self.built['image']
        altered = helper.expected_program()
        altered['dist/assets/atelier-old.js'] = sha(b'changed fitting room')
        helper.run = lambda _args: json.dumps(altered)
        with patch.object(helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024**3)):
            with patch.object(helper.subprocess, 'run'):
                with self.assertRaisesRegex(RuntimeError, 'Candidate runtime differs'):
                    helper.build()
        self.assertFalse((helper.ROOT / 'build-result.json').exists())

    def test_insufficient_space_fails_before_backup_or_runtime_mutation(self):
        helper = self.helper
        helper.payload = lambda: None
        helper.baseline = lambda: {**helper.OLD, 'availableBytes': 5 * 1024**3}
        helper.build_reserve = lambda: 5 * 1024**3 + 1
        with self.assertRaisesRegex(RuntimeError, 'Insufficient free disk space'):
            helper.build()
        self.assertFalse(helper.BACKUP.exists())
        self.assertFalse((helper.ROOT / 'runtime-context').exists())

    def test_publication_rechecks_space_before_source_or_container_mutation(self):
        helper = self.helper
        helper.payload = lambda: None
        helper.baseline = lambda: copy.deepcopy(helper.OLD)
        helper.publication_reserve = lambda: 5 * 1024**3 + 1
        with patch.object(helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=5 * 1024**3)):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient free disk space before publication'):
                helper.publish()
        for name, content in self.original.items():
            self.assertEqual((helper.LIVE / name).read_bytes(), content)
        self.assertFalse((helper.ROOT / 'published.json').exists())

    def test_backup_guard_rejects_symlinked_archive(self):
        self.backups()
        archive = self.helper.BACKUP / 'source.tgz'
        moved = self.helper.BACKUP / 'actual-source.tgz'
        archive.rename(moved)
        archive.symlink_to(moved)
        with self.assertRaisesRegex(RuntimeError, 'Invalid source backup file'):
            self.helper.backup_guard(self.built)

    def test_backup_resume_rejects_symlinked_index(self):
        self.backups()
        index = self.helper.BACKUP / 'index.html'
        moved = self.helper.BACKUP / 'actual-index.html'
        index.rename(moved)
        index.symlink_to(moved)
        with self.assertRaisesRegex(RuntimeError, 'Invalid retained client index backup'):
            self.helper.verify_existing_backup()

    def test_resume_reuses_only_complete_verified_source_and_rollback_images(self):
        self.backups()
        helper = self.helper
        helper.image = lambda ref: helper.OLD['preparedImage']
        helper.verify_existing_backup()
        helper.image = lambda ref: 'changed-image'
        with self.assertRaisesRegex(RuntimeError, 'Existing rollback image tag differs'):
            helper.verify_existing_backup()

    def test_resume_refuses_a_built_release(self):
        self.backups()
        (self.helper.ROOT / 'build-result.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'cannot be rebuilt'):
            self.helper.verify_existing_backup()

if __name__ == '__main__':
    unittest.main()
