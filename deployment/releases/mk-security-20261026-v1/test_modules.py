"""Exercise the common two-module phase with the real local module installer."""
from pathlib import Path
from types import SimpleNamespace
import copy
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
GAMES = ['mortal-kombat', 'studio-cosmic-escape']
sha = lambda value: hashlib.sha256(value).hexdigest()


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def load_python(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class CommonModuleReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='common-module-test-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        self.fixture = root
        self.root, self.live, self.modules, self.state, self.backup = [root / name for name in ['payload', 'live', 'modules', 'state', 'backup']]
        for directory in [self.root, self.live, self.modules, self.state, self.backup]:
            directory.mkdir()
        helper_names = ['deploy.py', 'snapshot.py', 'modules.py', 'runtime-inventory.cjs', 'quiesce.cjs', 'verify-runtime.cjs']
        for name in helper_names:
            shutil.copy2(HERE / name, self.root / name)
        target = self.live / 'scripts/game-module-release.py'
        target.parent.mkdir()
        shutil.copy2(PROJECT / 'scripts/game-module-release.py', target)
        self.old_version, self.version = '1.0.0-aaaaaaaaaaaa', '1.0.0-bbbbbbbbbbbb'
        self.old_pointers, self.metadatas = {}, {}
        for game in GAMES:
            self.package(self.modules / game / 'versions' / self.old_version, game, self.old_version, ('old ' + game).encode())
            old_manifest = self.modules / game / 'versions' / self.old_version / 'manifest.json'
            old_value = {'sha256': sha(old_manifest.read_bytes()), 'manifest': '/game-modules/' + game + '/versions/' + self.old_version + '/manifest.json', 'gameId': game, 'format': 1}
            raw = ('  ' + json.dumps(old_value, separators=(',', ':')) + '\r\n').encode()
            (self.modules / game / 'active.json').write_bytes(raw)
            self.old_pointers[game] = raw
            package = self.root / 'modules' / game / 'versions' / self.version
            self.metadatas[game] = self.package(package, game, self.version, ('new reviewed ' + game).encode())
        other = self.modules / 'studio-dracona/active.json'
        other.parent.mkdir()
        other.write_bytes(b'retained unrelated pointer\n')
        host = {'format': 1, 'games': {game: {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 1} for game in GAMES}}
        host['games']['studio-dracona'] = {'apiVersion': 1, 'rulesVersion': 3, 'progressVersion': 3}
        save_json(self.state / 'host.json', host)
        shutil.copy2(self.state / 'host.json', self.root / 'host.json')
        old_image, new_image = 'sha256:' + 'a' * 64, 'sha256:' + 'b' * 64
        before_source = {'scripts/game-module-release.py': sha(target.read_bytes()), 'src/shared/luelonSlotsLines.ts': sha(b'old validator'), 'server/activities.ts': sha(b'old public serializer')}
        for name, value in {'src/shared/luelonSlotsLines.ts': b'fixed validator', 'server/activities.ts': b'fixed public serializer'}.items():
            path = self.live / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
        self.before = {'sourceRevision': 'a' * 40, 'source': before_source, 'sourceLF': dict(before_source),
            'program': {'dist/index.html': sha(b'old index'), 'dist/assets/old.js': sha(b'old asset'),
                        'dist-server/index.js': sha(b'old backend'), 'dist-server/payments.js': sha(b'payment backend'),
                        'node_modules/pg/index.js': sha(b'unchanged dependency')},
            'configHashes': {'.env': sha(b'private settings'), 'compose.yaml': sha(b'compose settings')},
            'moduleFiles': self.module_files(), 'moduleHostContract': sha((self.state / 'host.json').read_bytes()), 'moduleHost': host,
            'realMoneyFlags': {'enabled': 'false'},
            'services': {'/royal-game-1': {'id': 'old game'}, '/royal-payments-1': {'id': 'payment service'}},
            'container': {'id': 'old game', 'image': old_image, 'health': 'healthy', 'startedAt': 'old start',
                          'mounts': [{'Destination': '/app/data', 'Name': 'game_data'}], 'host': {'Memory': 1},
                          'runtimeHash': sha(b'runtime settings'), 'composeFiles': 'compose.yaml'},
            'preparedImage': old_image}
        self.before['preparedProgram'] = copy.deepcopy(self.before['program'])
        module_delta = {str(path.relative_to(self.root / 'modules')): sha(path.read_bytes()) for path in (self.root / 'modules').rglob('*') if path.is_file()}
        self.manifest = {'release': 'mk-security-20261026-v1', 'sourceCommit': 'c' * 40, 'baseCommit': 'a' * 40,
            'before': self.before,
            'changed': {name: sha((self.live / name).read_bytes()) for name in ['src/shared/luelonSlotsLines.ts', 'server/activities.ts']},
            'delta': {'index.html': sha(b'new index'), 'assets/new.js': sha(b'new asset')},
            'serverDelta': {'index.js': sha(b'fixed combined backend')}, 'runtimePackages': {}, 'dependencyFiles': {},
            'moduleDelta': module_delta,
            'modulePackages': [{'gameId': game, 'version': self.version, 'beforeSha256': sha(self.old_pointers[game])} for game in GAMES],
            'moduleInstallerSha256': sha(target.read_bytes()), 'hostContractSha256': self.before['moduleHostContract'],
            'helpers': {name: sha((self.root / name).read_bytes()) for name in helper_names}}
        self.save_manifest()
        self.deploy = load_python('common_deploy_fixture', self.root / 'deploy.py')
        self.deploy.LIVE, self.deploy.BACKUP, self.deploy.STATE = self.live, self.backup, self.state
        self.built = {'image': new_image, 'sourceCommit': self.manifest['sourceCommit'], 'program': self.deploy.expected_program()}
        self.after = copy.deepcopy(self.before)
        self.after['source'].update(self.manifest['changed'])
        self.after['sourceRevision'] = self.manifest['sourceCommit']
        self.after['container'].update({'id': 'new game', 'image': new_image, 'startedAt': 'new start'})
        self.after['services']['/royal-game-1']['id'] = 'new game'
        self.after.update({'preparedImage': new_image, 'program': copy.deepcopy(self.built['program']), 'preparedProgram': copy.deepcopy(self.built['program'])})
        save_json(self.root / 'build-result.json', self.built)
        save_json(self.root / 'after.json', self.after)
        save_json(self.root / 'published.json', {'published': True, 'sourceCommit': self.manifest['sourceCommit'], 'runningImage': new_image, 'preparedImage': new_image, 'image': new_image})
        self.settings_calls = []
        actual_settings = self.deploy.settings
        self.deploy.OLD = self.production_paths(self.deploy.OLD)
        def settings(state, *args, **kwargs):
            self.settings_calls.append(kwargs)
            return actual_settings(self.production_paths(state), *args, **kwargs)
        self.deploy.settings, self.deploy.snapshot = settings, self.snapshot
        deploy_import = patch.dict(sys.modules, {'deploy': self.deploy})
        deploy_import.start()
        self.addCleanup(deploy_import.stop)
        self.helper = load_python('common_modules_under_test', self.root / 'modules.py')
        self.helper.ROOT, self.helper.EXPECTED_ROOT = self.root, self.root
        self.helper.LIVE, self.helper.STATE, self.helper.MODULES, self.helper.BACKUP = self.live, self.state, self.modules, self.backup
        disk = patch.object(shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024**3))
        disk.start()
        self.addCleanup(disk.stop)
        self.database = self.fixture / 'player-data-marker'
        self.database.write_bytes(b'Never modify or restore player data')
        self.stable_application = self.application_files()

    def test_isolated_combat_publication_preserves_cosmic_and_other_modules(self):
        isolated = self.fixture/'mk-security-only-20261026-v1'
        self.root.rename(isolated)
        self.root = isolated
        self.manifest['release'] = isolated.name
        self.deploy.ROOT, self.deploy.NAME = isolated, isolated.name
        self.helper = load_python('isolated_combat_modules_under_test', self.root/'modules.py')
        self.helper.EXPECTED_ROOT = isolated
        self.helper.LIVE, self.helper.STATE, self.helper.MODULES, self.helper.BACKUP = self.live, self.state, self.modules, self.backup
        self.assertEqual(self.helper.NAME, isolated.name)
        self.manifest['moduleScope'] = 'combat-only'
        self.manifest['modulePackages'] = self.manifest['modulePackages'][:1]
        self.manifest['moduleDelta'] = {k:v for k,v in self.manifest['moduleDelta'].items() if k.startswith('mortal-kombat/')}
        del self.manifest['changed']['src/shared/luelonSlotsLines.ts']
        (self.live/'src/shared/luelonSlotsLines.ts').write_bytes(b'old validator')
        self.after['source']['src/shared/luelonSlotsLines.ts'] = self.before['source']['src/shared/luelonSlotsLines.ts']
        shutil.rmtree(self.root/'modules/studio-cosmic-escape')
        self.save_manifest()
        save_json(self.root/'after.json', self.after)
        self.deploy.M = self.manifest
        self.deploy.CHANGES = self.manifest['changed']
        self.stable_application = self.application_files()
        other_before = {k:v for k,v in self.module_files().items() if '/mortal-kombat/' not in k}
        result = self.helper.publish()
        self.assertEqual([x['gameId'] for x in result['packages']], ['mortal-kombat'])
        self.assertEqual({k:v for k,v in self.module_files().items() if '/mortal-kombat/' not in k}, other_before)
        self.assertEqual((self.modules/'studio-cosmic-escape/active.json').read_bytes(), self.old_pointers['studio-cosmic-escape'])
        self.assertFalse((self.modules/'studio-cosmic-escape/versions'/self.version).exists())

    def tearDown(self):
        self.assertEqual(self.application_files(), self.stable_application)
        self.assertEqual(self.database.read_bytes(), b'Never modify or restore player data')

    def package(self, root, game, version, entry):
        root.mkdir(parents=True)
        style = ('.' + game + ' { color: purple; }').encode()
        files = {'entry-' + sha(entry)[:16] + '.js': entry, 'style-' + sha(style)[:16] + '.css': style,
                 'media/nested/status.json': b'{"status":"reviewed fixture"}\n'}
        for name, value in files.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_bytes(value)
        metadata = {'format': 1, 'gameId': game, 'version': version, 'apiVersion': 1, 'rulesVersion': 2,
                    'progressVersion': 1, 'sourceSha256': 'e' * 64,
                    'entry': next(name for name in files if name.endswith('.js')),
                    'styles': [next(name for name in files if name.endswith('.css'))],
                    'files': {name: sha(value) for name, value in files.items()}}
        save_json(root / 'manifest.json', metadata)
        return metadata

    def save_manifest(self):
        save_json(self.root / 'install-manifest.json', self.manifest)

    def module_files(self):
        return {str(path): sha(path.read_bytes()) for path in self.modules.rglob('*') if path.is_file()}

    def application_files(self):
        return {str(path): path.read_bytes() for path in self.live.rglob('*') if path.is_file()}

    def production_paths(self, value):
        result = copy.deepcopy(value)
        if 'moduleFiles' in result:
            result['moduleFiles'] = {name.replace(str(self.modules) + '/', '/opt/royal-game-modules/', 1): digest for name, digest in result['moduleFiles'].items()}
        return result

    def snapshot(self, *args, **kwargs):
        state = copy.deepcopy(self.after)
        state['moduleFiles'] = self.module_files()
        state['moduleHostContract'] = sha((self.state / 'host.json').read_bytes())
        state['moduleHost'] = json.loads((self.state / 'host.json').read_text())
        state['source'] = {str(path.relative_to(self.live)): sha(path.read_bytes()) for path in self.live.rglob('*') if path.is_file()}
        return state

    def pointer(self, game):
        return self.modules / game / 'active.json'

    def pointer_bytes(self):
        return {game: self.pointer(game).read_bytes() if self.pointer(game).is_file() else None for game in GAMES}

    def assert_original_pointers(self):
        self.assertEqual(self.pointer_bytes(), self.old_pointers)

    def assert_new_files(self, games=GAMES):
        for name, digest in self.manifest['moduleDelta'].items():
            if name.split('/')[0] in games:
                self.assertEqual(sha((self.modules / name).read_bytes()), digest, name)

    def context(self):
        return self.helper.load_context()

    def publish(self):
        return self.helper.publish()

    def test_context_verifies_both_packages_with_real_installer_without_mutation(self):
        before = self.module_files()
        context = self.context()
        self.assertEqual([row['gameId'] for row in context['rows']], GAMES)
        self.assertEqual(set(context['metadatas']), set(GAMES))
        self.assertGreater(context['total'], 0)
        self.assertEqual(self.module_files(), before)
        self.assertEqual(list(self.backup.iterdir()), [])

    def test_preflight_does_not_write_installer_bytecode_when_bytecode_is_enabled(self):
        original = self.application_files()
        self.assertFalse((self.live / 'scripts/__pycache__').exists())
        with patch.object(sys, 'dont_write_bytecode', False):
            context = self.context()
            self.assertTrue(context['installer'].verify)
        self.assertEqual(self.application_files(), original)
        self.assertFalse((self.live / 'scripts/__pycache__').exists())

    def test_capacity_total_includes_both_manifest_files(self):
        context = self.context()
        expected = sum((self.root / 'modules' / name).stat().st_size for name in self.manifest['moduleDelta'])
        self.assertEqual(context['total'], expected)

    def test_reserve_rejects_manifest_and_backup_overhead_boundary(self):
        resource_bytes = sum(sum((self.root / 'modules' / game / 'versions' / self.version / name).stat().st_size
                                 for name in self.metadatas[game]['files']) for game in GAMES)
        original = self.module_files()
        with patch.object(shutil, 'disk_usage', return_value=SimpleNamespace(free=5 * 1024**3 + 3 * resource_bytes + 1)):
            with self.assertRaisesRegex(RuntimeError, 'capacity'):
                self.publish()
        self.assertEqual(self.module_files(), original)
        self.assertEqual(list(self.backup.iterdir()), [])

    def test_publish_changes_exactly_two_pointers_and_adds_only_reviewed_versions(self):
        original = self.module_files()
        host = (self.state / 'host.json').read_bytes()
        result = self.publish()
        self.assertTrue(result['published'])
        self.assertEqual({row['gameId'] for row in result['packages']}, set(GAMES))
        pointers = {str(self.pointer(game)) for game in GAMES}
        actual = self.module_files()
        for name, digest in original.items():
            if name not in pointers:
                self.assertEqual(actual[name], digest, name)
        self.assertEqual(set(actual) - set(original), {str(self.modules / name) for name in self.manifest['moduleDelta']})
        self.assertEqual((self.state / 'host.json').read_bytes(), host)
        self.assert_new_files()
        self.assertTrue(self.settings_calls)

    def test_rollback_restores_raw_pointer_bytes_and_preserves_old_and_new_urls(self):
        original = self.module_files()
        self.publish()
        new_files = self.module_files()
        result = self.helper.rollback_pointers()
        self.assertTrue(result['restored'])
        self.assert_original_pointers()
        for name, digest in original.items():
            self.assertEqual(sha(Path(name).read_bytes()), digest)
        for name, digest in new_files.items():
            if name not in {str(self.pointer(game)) for game in GAMES}:
                self.assertEqual(sha(Path(name).read_bytes()), digest)

    def test_unrelated_payload_and_game_identity_rejected_without_pointer_changes(self):
        path = self.root / 'modules/unreviewed.txt'
        path.write_bytes(b'unreviewed')
        with self.assertRaises((RuntimeError, AssertionError)):
            self.context()
        path.unlink()
        self.manifest['modulePackages'][1]['gameId'] = 'studio-velvet-reign'
        self.save_manifest()
        with self.assertRaises((RuntimeError, AssertionError)):
            self.context()
        self.assert_original_pointers()

    def test_duplicate_package_or_missing_game_is_rejected(self):
        original = copy.deepcopy(self.manifest['modulePackages'])
        for rows in [[original[0]], [original[0], original[0]], original + [original[0]]]:
            self.manifest['modulePackages'] = rows
            self.save_manifest()
            with self.assertRaises((RuntimeError, AssertionError)):
                self.context()
        self.assert_original_pointers()

    def test_reviewed_pointer_must_equal_baseline_snapshot(self):
        self.manifest['modulePackages'][1]['beforeSha256'] = 'f' * 64
        self.save_manifest()
        with self.assertRaises((RuntimeError, AssertionError)):
            self.context()
        self.assert_original_pointers()

    def test_tampered_helper_or_installer_rejected_before_pointer_mutation(self):
        for path in [self.root / name for name in ['modules.py', 'deploy.py', 'snapshot.py']] + [self.live / 'scripts/game-module-release.py']:
            raw = path.read_bytes()
            path.write_bytes(raw + b'\n# tampered\n')
            with self.subTest(path=path), self.assertRaises((RuntimeError, AssertionError)):
                self.context()
            path.write_bytes(raw)
        self.assert_original_pointers()

    def test_resource_tamper_not_hidden_by_updating_payload_inventory(self):
        game = GAMES[1]
        entry = self.root / 'modules' / game / 'versions' / self.version / self.metadatas[game]['entry']
        entry.write_bytes(b'tampered executable')
        self.manifest['moduleDelta'][str(entry.relative_to(self.root / 'modules'))] = sha(entry.read_bytes())
        self.save_manifest()
        with self.assertRaises((RuntimeError, AssertionError)):
            self.context()
        self.assert_original_pointers()

    def test_wrong_contract_or_version_rejected(self):
        path = self.root / 'modules' / GAMES[1] / 'versions' / self.version / 'manifest.json'
        metadata = json.loads(path.read_text())
        for key, value in [('rulesVersion', 3), ('version', self.old_version)]:
            changed = {**metadata, key: value}
            save_json(path, changed)
            self.manifest['moduleDelta'][str(path.relative_to(self.root / 'modules'))] = sha(path.read_bytes())
            self.save_manifest()
            with self.subTest(key=key), self.assertRaises((RuntimeError, AssertionError)):
                self.context()
        self.assert_original_pointers()

    def test_immutable_old_module_bytes_cannot_be_replaced(self):
        relative = next(iter(self.manifest['moduleDelta']))
        self.manifest['before']['moduleFiles'][str(self.modules / relative)] = 'f' * 64
        self.save_manifest()
        with self.assertRaises((RuntimeError, AssertionError)):
            self.context()
        self.assert_original_pointers()

    def test_symlinked_payload_module_or_pointer_rejected(self):
        game = GAMES[1]
        entry = self.root / 'modules' / game / 'versions' / self.version / self.metadatas[game]['entry']
        raw = entry.read_bytes()
        target = self.fixture / 'retained-entry'
        target.write_bytes(raw)
        entry.unlink()
        entry.symlink_to(target)
        with self.assertRaises((RuntimeError, AssertionError)):
            self.context()
        entry.unlink()
        entry.write_bytes(raw)
        pointer = self.pointer(GAMES[0])
        target = self.fixture / 'retained-pointer'
        target.write_bytes(pointer.read_bytes())
        pointer.unlink()
        pointer.symlink_to(target)
        try:
            with self.assertRaises((RuntimeError, AssertionError)):
                self.publish()
        finally:
            pointer.unlink()
            pointer.write_bytes(self.old_pointers[GAMES[0]])

    def test_low_disk_refuses_before_backup_or_pointer_writes(self):
        original = self.module_files()
        with patch.object(shutil, 'disk_usage', return_value=SimpleNamespace(free=5 * 1024**3)):
            with self.assertRaises((RuntimeError, AssertionError)):
                self.publish()
        self.assertEqual(self.module_files(), original)
        self.assertEqual(list(self.backup.iterdir()), [])

    def test_foreign_pointer_host_and_module_changes_fail_closed(self):
        originals = self.pointer_bytes()
        for path in [self.pointer(GAMES[0]), self.pointer(GAMES[1]), self.modules / 'studio-dracona/active.json', self.state / 'host.json']:
            raw = path.read_bytes()
            path.write_bytes(raw + b'\nforeign publication\n')
            with self.subTest(path=path), self.assertRaises((RuntimeError, AssertionError, ValueError)):
                self.publish()
            self.assertEqual(self.pointer_bytes(), {game: (raw + b'\nforeign publication\n') if path == self.pointer(game) else originals[game] for game in GAMES})
            path.write_bytes(raw)
        extra = self.modules / 'studio-dracona/new.js'
        extra.write_bytes(b'unreviewed new URL')
        with self.assertRaises((RuntimeError, AssertionError)):
            self.publish()
        self.assert_original_pointers()

    def test_later_application_state_blocks_publish(self):
        original = copy.deepcopy(self.after)
        changes = [lambda s: s.update(sourceRevision='f' * 40), lambda s: s['container'].update(id='later container'),
                   lambda s: s['container'].update(image='sha256:' + 'f' * 64), lambda s: s['container'].update(health='unhealthy'),
                   lambda s: s.update(preparedImage='sha256:' + 'f' * 64), lambda s: s['program'].update({'dist-server/index.js': 'f' * 64}),
                   lambda s: s['preparedProgram'].update({'dist-server/index.js': 'f' * 64}), lambda s: s['configHashes'].update({'.env': 'f' * 64}),
                   lambda s: s['container'].update(mounts=[]), lambda s: s['realMoneyFlags'].update(enabled='true'),
                   lambda s: s['services']['/royal-payments-1'].update(id='later payments')]
        for change in changes:
            self.after = copy.deepcopy(original)
            change(self.after)
            with self.subTest(state=self.after), self.assertRaises((RuntimeError, AssertionError)):
                self.publish()
            self.assert_original_pointers()
        self.after = original

    def test_changed_live_source_blocks_publication_without_overwrite(self):
        path = self.live / 'src/shared/luelonSlotsLines.ts'
        raw = path.read_bytes()
        path.write_bytes(b'later source')
        try:
            with self.assertRaises((RuntimeError, AssertionError)):
                self.publish()
            self.assertEqual(path.read_bytes(), b'later source')
            self.assert_original_pointers()
        finally:
            path.write_bytes(raw)

    def test_build_and_application_records_are_bound_to_source_and_runtime(self):
        for filename, mutate in [('build-result.json', lambda v: v['program'].update({'dist-server/index.js': 'f' * 64})),
                                 ('after.json', lambda v: v['container'].update(id='later recorded game')),
                                 ('published.json', lambda v: v.update(sourceCommit='f' * 40))]:
            path = self.root / filename
            raw = path.read_bytes()
            value = json.loads(raw)
            mutate(value)
            save_json(path, value)
            with self.subTest(filename=filename), self.assertRaises((RuntimeError, AssertionError)):
                self.publish()
            path.write_bytes(raw)
            self.assert_original_pointers()

    def test_both_raw_backups_exist_before_first_install(self):
        context = self.context()
        original = context['installer'].run
        seen = []
        def checked(args):
            if args.operation == 'install':
                self.helper.verify_backup(context)
                for game in GAMES:
                    self.assertEqual(self.helper.pointer_backup(game).read_bytes(), self.old_pointers[game])
                seen.append(args.game)
            return original(args)
        context['installer'].run = checked
        with patch.object(self.helper, 'load_context', return_value=context):
            self.publish()
        self.assertEqual(seen, GAMES)

    def install_failure(self, after_pointer=False, unexpected_pointer=False, pending=False):
        context = self.context()
        original = context['installer'].run
        calls = []
        def failure(args):
            calls.append((args.operation, args.game))
            if args.operation == 'install' and args.game == GAMES[1]:
                if pending:
                    partial = self.modules / GAMES[1] / 'versions/.pending-interrupted'
                    partial.mkdir()
                    (partial / 'entry-partial.js').write_bytes(b'incomplete resource')
                if after_pointer:
                    original(args)
                if unexpected_pointer:
                    self.pointer(GAMES[1]).write_bytes(b'foreign pointer after interrupted publication')
                raise RuntimeError('simulated second installation failure')
            return original(args)
        context['installer'].run = failure
        with patch.object(self.helper, 'load_context', return_value=context), patch.object(self.helper.signal, 'signal'):
            with self.assertRaises(RuntimeError):
                self.publish()
        return context, calls

    def test_second_install_failure_before_pointer_restores_first_raw_pointer(self):
        self.install_failure()
        self.assert_original_pointers()
        self.assert_new_files([GAMES[0]])
        self.assertFalse((self.modules / GAMES[1] / 'versions' / self.version).exists())
        report = json.loads((self.root / 'modules-failed.json').read_text())
        self.assertTrue(report['pointersRestored'])
        self.assertEqual(report['restoredPointerCount'], 1)
        self.assertFalse((self.root / 'modules-published.json').exists())

    def test_second_install_failure_after_pointer_restores_both_raw_pointers(self):
        self.install_failure(after_pointer=True)
        self.assert_original_pointers()
        self.assert_new_files()
        report = json.loads((self.root / 'modules-failed.json').read_text())
        self.assertTrue(report['pointersRestored'])
        self.assertEqual(report['restoredPointerCount'], 2)
        self.assertFalse((self.root / 'modules-published.json').exists())

    def test_unreviewed_pending_copy_is_retained_and_blocks_automatic_recovery(self):
        context, _ = self.install_failure(pending=True)
        self.assertEqual(sha(self.pointer(GAMES[0]).read_bytes()), self.helper.installed_sha(context, GAMES[0]))
        self.assertEqual(self.pointer(GAMES[1]).read_bytes(), self.old_pointers[GAMES[1]])
        self.assertTrue((self.modules / GAMES[1] / 'versions/.pending-interrupted/entry-partial.js').is_file())
        self.assertFalse(json.loads((self.root / 'modules-failed.json').read_text())['pointersRestored'])

    def test_foreign_second_pointer_prevents_any_partial_pointer_recovery(self):
        context, _ = self.install_failure(after_pointer=True, unexpected_pointer=True)
        self.assertEqual(sha(self.pointer(GAMES[0]).read_bytes()), self.helper.installed_sha(context, GAMES[0]))
        self.assertEqual(self.pointer(GAMES[1]).read_bytes(), b'foreign pointer after interrupted publication')
        self.assertFalse(json.loads((self.root / 'modules-failed.json').read_text())['pointersRestored'])

    def test_retry_after_first_installed_skips_its_install_and_finishes_second(self):
        context = self.context()
        self.helper.backup(context)
        context['installer'].run(self.helper.arguments(context, context['rows'][0], 'install'))
        prior_first = self.pointer(GAMES[0]).read_bytes()
        first_urls = {name: digest for name, digest in self.module_files().items() if '/'+GAMES[0]+'/versions/' in name}
        original, installs = context['installer'].run, []
        def checked(args):
            if args.operation == 'install':
                installs.append(args.game)
            return original(args)
        context['installer'].run = checked
        with patch.object(self.helper, 'load_context', return_value=context):
            result = self.publish()
        self.assertEqual(installs, [GAMES[1]])
        self.assertTrue(result['packages'][0]['reusedActive'])
        self.assertEqual(self.pointer(GAMES[0]).read_bytes(), prior_first)
        for name, digest in first_urls.items():
            self.assertEqual(sha(Path(name).read_bytes()), digest)
        self.assert_new_files()

    def test_retry_after_both_installed_reuses_verified_versions_without_new_history(self):
        self.publish()
        pointers = self.pointer_bytes()
        history = {path.name: path.read_bytes() for path in (self.state / 'history').iterdir()}
        result = self.publish()
        self.assertTrue(all(row['reusedActive'] for row in result['packages']))
        self.assertEqual(self.pointer_bytes(), pointers)
        self.assertEqual(history, {path.name: path.read_bytes() for path in (self.state / 'history').iterdir()})

    def test_incomplete_backup_is_not_overwritten(self):
        for path in [self.backup / 'joint-module-host.json', self.helper.pointer_backup(GAMES[0])]:
            path.write_bytes(b'unreviewed existing backup')
            original = self.module_files()
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, 'Incomplete module backup'):
                self.publish()
            self.assertEqual(path.read_bytes(), b'unreviewed existing backup')
            self.assertEqual(self.module_files(), original)
            path.unlink()

    def test_backup_record_host_and_both_raw_pointers_are_verified_before_any_restore(self):
        self.publish()
        installed = self.pointer_bytes()
        paths = [self.backup / 'joint-module-backup.json', self.backup / 'joint-module-host.json',
                 *[self.helper.pointer_backup(game) for game in GAMES]]
        for path in paths:
            raw = path.read_bytes()
            if path.name == 'joint-module-backup.json':
                value = json.loads(raw)
                value['sourceCommit'] = 'f' * 40
                save_json(path, value)
            else:
                path.write_bytes(b'tampered backup')
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                self.helper.rollback_pointers()
            self.assertEqual(self.pointer_bytes(), installed)
            path.write_bytes(raw)

    def test_backup_reuse_requires_exact_metadata_and_original_raw_bytes(self):
        context = self.context()
        self.helper.backup(context)
        before = {path.name: path.read_bytes() for path in self.backup.iterdir()}
        self.helper.backup(context)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.backup.iterdir()})
        path = self.helper.pointer_backup(GAMES[1])
        path.write_bytes(b'changed backup bytes')
        with self.assertRaisesRegex(RuntimeError, 'Retained pointer backup differs'):
            self.helper.backup(context)

    def test_rollback_preflights_foreign_second_pointer_before_restoring_first(self):
        self.publish()
        first = self.pointer(GAMES[0]).read_bytes()
        self.pointer(GAMES[1]).write_bytes(b'later foreign pointer')
        with self.assertRaises(RuntimeError):
            self.helper.rollback_pointers()
        self.assertEqual(self.pointer(GAMES[0]).read_bytes(), first)
        self.assertEqual(self.pointer(GAMES[1]).read_bytes(), b'later foreign pointer')

    def test_rollback_compare_and_swap_refuses_pointer_changed_after_preflight(self):
        self.publish()
        second = self.pointer(GAMES[1]).read_bytes()
        original, calls = self.helper.pointer_hash, []
        def changed(path):
            calls.append(path)
            if len(calls) == 3:
                self.pointer(GAMES[0]).write_bytes(b'concurrent foreign pointer')
            return original(path)
        with patch.object(self.helper, 'pointer_hash', side_effect=changed):
            with self.assertRaisesRegex(RuntimeError, 'Pointer or host changed during recovery'):
                self.helper.rollback_pointers()
        self.assertEqual(self.pointer(GAMES[0]).read_bytes(), b'concurrent foreign pointer')
        self.assertEqual(self.pointer(GAMES[1]).read_bytes(), second)

    def test_rollback_refuses_later_source_image_host_or_foreign_module(self):
        self.publish()
        pointers = self.pointer_bytes()
        old_after = copy.deepcopy(self.after)
        self.after['container']['image'] = 'sha256:' + 'f' * 64
        with self.assertRaises(RuntimeError):
            self.helper.rollback_pointers()
        self.assertEqual(self.pointer_bytes(), pointers)
        self.after = old_after
        for path in [self.live / 'server/activities.ts', self.state / 'host.json', self.modules / 'studio-dracona/active.json']:
            raw = path.read_bytes()
            path.write_bytes(raw + b'\nforeign bytes\n')
            try:
                with self.subTest(path=path), self.assertRaises((RuntimeError, ValueError)):
                    self.helper.rollback_pointers()
                self.assertEqual(self.pointer_bytes(), pointers)
            finally:
                path.write_bytes(raw)

    def test_module_installer_check_result_must_match_both_requested_games(self):
        context = self.context()
        original = context['installer'].run
        def bad_check(args):
            result = original(args)
            if args.operation == 'check' and args.game == GAMES[1]:
                result['gameId'] = GAMES[0]
            return result
        context['installer'].run = bad_check
        with patch.object(self.helper, 'load_context', return_value=context), self.assertRaisesRegex(RuntimeError, 'installer check differs'):
            self.publish()
        self.assert_original_pointers()
        self.assertEqual(list(self.backup.iterdir()), [])

    def test_incorrect_second_install_result_after_pointer_triggers_two_pointer_restore(self):
        context = self.context()
        original = context['installer'].run
        def bad_result(args):
            result = original(args)
            if args.operation == 'install' and args.game == GAMES[1]:
                result['activeSha256'] = 'f' * 64
            return result
        context['installer'].run = bad_result
        with patch.object(self.helper, 'load_context', return_value=context), patch.object(self.helper.signal, 'signal'):
            with self.assertRaisesRegex(RuntimeError, 'Published module pointer differs'):
                self.publish()
        self.assert_original_pointers()
        self.assert_new_files()

    def test_absent_external_pointers_install_and_rollback_keep_bundled_fallback(self):
        for game in GAMES:
            self.pointer(game).unlink()
            self.manifest['before']['moduleFiles'].pop(str(self.pointer(game)))
            self.after['moduleFiles'].pop(str(self.pointer(game)))
            next(row for row in self.manifest['modulePackages'] if row['gameId'] == game)['beforeSha256'] = 'none'
        self.save_manifest()
        self.deploy.M['before'] = copy.deepcopy(self.manifest['before'])
        self.deploy.OLD = self.production_paths(self.manifest['before'])
        save_json(self.root / 'after.json', self.after)
        self.publish()
        self.assertTrue(all(self.pointer(game).is_file() for game in GAMES))
        self.helper.rollback_pointers()
        self.assertTrue(all(not self.pointer(game).exists() for game in GAMES))
        self.assertTrue(all(not self.helper.pointer_backup(game).exists() for game in GAMES))
        self.assert_new_files()

    def test_no_module_backup_and_no_pointer_changes_is_a_recovery_noop(self):
        result = self.helper.rollback_pointers()
        self.assertTrue(result['restored'])
        self.assertEqual(result['pointerCount'], 0)
        self.assert_original_pointers()
        self.assertEqual(list(self.backup.iterdir()), [])

    def test_missing_backup_record_after_install_refuses_recovery(self):
        self.publish()
        installed = self.pointer_bytes()
        (self.backup / 'joint-module-backup.json').unlink()
        with self.assertRaises(RuntimeError):
            self.helper.rollback_pointers()
        self.assertEqual(self.pointer_bytes(), installed)

    def test_backup_symlink_rejected_before_any_pointer_restore(self):
        self.publish()
        pointers = self.pointer_bytes()
        path = self.helper.pointer_backup(GAMES[1])
        raw = path.read_bytes()
        target = self.fixture / 'retained-pointer-backup'
        target.write_bytes(raw)
        path.unlink()
        path.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            self.helper.rollback_pointers()
        self.assertEqual(self.pointer_bytes(), pointers)

    def test_recovery_snapshot_without_program_probes_real_container_before_restoration(self):
        self.publish()
        self.after['program'] = None
        with patch.object(self.deploy, 'run', return_value=json.dumps(self.built['program'])) as command:
            result = self.helper.rollback_pointers()
        self.assertEqual(result['pointerCount'], 2)
        self.assert_original_pointers()
        command.assert_called_once_with(['docker', 'exec', 'royal-game-1', 'node', '-e', self.deploy.PROGRAM])
        self.assert_new_files()

    def test_recovery_probe_detects_tampered_runtime_before_pointer_changes(self):
        self.publish()
        installed = self.pointer_bytes()
        self.after['program'] = None
        tampered = {**self.built['program'], 'dist-server/index.js': 'f' * 64}
        with patch.object(self.deploy, 'run', return_value=json.dumps(tampered)) as command:
            with self.assertRaisesRegex(RuntimeError, 'Later running files prevent rollback'):
                self.helper.rollback_pointers()
        command.assert_called_once()
        self.assertEqual(self.pointer_bytes(), installed)

    def test_healthy_container_probe_failure_refuses_pointer_restoration(self):
        self.publish()
        installed = self.pointer_bytes()
        self.after['program'] = None
        with patch.object(self.deploy, 'run', side_effect=subprocess.CalledProcessError(1, ['docker', 'exec'])):
            with self.assertRaisesRegex(RuntimeError, 'Cannot verify files of the healthy game container'):
                self.helper.rollback_pointers()
        self.assertEqual(self.pointer_bytes(), installed)

    def test_passed_core_snapshot_is_guarded_without_replacing_it_by_a_fresh_snapshot(self):
        self.publish()
        installed = self.pointer_bytes()
        for change in [lambda v: v['program'].update({'dist-server/index.js': 'f' * 64}),
                       lambda v: v['source'].update({'server/activities.ts': 'f' * 64}),
                       lambda v: v['container'].update(image='sha256:' + 'f' * 64)]:
            current = self.snapshot()
            change(current)
            with patch.object(self.deploy, 'snapshot', side_effect=AssertionError('Passed core snapshot must be reused')):
                with self.assertRaises(RuntimeError):
                    self.helper.rollback_pointers(current)
            self.assertEqual(self.pointer_bytes(), installed)

    def test_rollback_build_receipt_must_match_reviewed_source_and_program_before_probe(self):
        self.publish()
        installed = self.pointer_bytes()
        self.after['program'] = None
        path = self.root / 'build-result.json'
        raw = path.read_bytes()
        for change in [lambda v: v.update(sourceCommit='f' * 40), lambda v: v['program'].update({'dist-server/index.js': 'f' * 64})]:
            built = json.loads(raw)
            change(built)
            save_json(path, built)
            with patch.object(self.deploy, 'run') as command:
                with self.assertRaisesRegex(RuntimeError, 'Reviewed application build differs'):
                    self.helper.rollback_pointers()
            command.assert_not_called()
            self.assertEqual(self.pointer_bytes(), installed)
        path.write_bytes(raw)

    def assert_published_resource_modes(self, games=GAMES):
        for game in games:
            root = self.modules / game / 'versions' / self.version
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o755)
            self.assertTrue((root / 'media/nested/status.json').is_file())
            for path in root.rglob('*'):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755 if path.is_dir() else 0o644, str(path))
        for path in [self.backup / 'joint-module-backup.json', self.backup / 'joint-module-host.json',
                     *[self.helper.pointer_backup(game) for game in GAMES]]:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600, str(path))

    def test_restrictive_umask_publishes_readable_resources_and_restores_original_mask(self):
        original_mask = os.umask(0o077)
        try:
            result = self.publish()
            self.assertTrue(result['published'])
            self.assertEqual(os.umask(0o077), 0o077)
            self.assert_published_resource_modes()
            for game in GAMES:
                self.assertEqual(stat.S_IMODE(self.pointer(game).stat().st_mode), 0o644)
        finally:
            os.umask(original_mask)

    def test_restrictive_umask_is_restored_after_second_failure_before_pointer(self):
        original_mask = os.umask(0o077)
        try:
            self.install_failure()
            self.assertEqual(os.umask(0o077), 0o077)
            self.assert_original_pointers()
            self.assert_published_resource_modes([GAMES[0]])
            self.assertFalse((self.modules / GAMES[1] / 'versions' / self.version).exists())
        finally:
            os.umask(original_mask)

    def test_restrictive_umask_is_restored_after_second_failure_after_pointer(self):
        original_mask = os.umask(0o077)
        try:
            self.install_failure(after_pointer=True)
            self.assertEqual(os.umask(0o077), 0o077)
            self.assert_original_pointers()
            self.assert_published_resource_modes()
            for game in GAMES:
                self.assertEqual(stat.S_IMODE(self.pointer(game).stat().st_mode), 0o644)
        finally:
            os.umask(original_mask)


if __name__ == '__main__':
    unittest.main(verbosity=2)
