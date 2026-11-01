"""Exercise only local fixtures; never invoke Docker or production programs."""
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def digest(data): return hashlib.sha256(data).hexdigest()


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class LocationInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.scope = json.loads((HERE / 'scope.json').read_text())
        native_module = load(HERE / 'deploy.py', 'location_native_contract')
        for name in ['deploy.py', 'snapshot.py', 'scope.json', 'quiesce.cjs']: shutil.copy2(HERE / name, self.root / name)
        for target, source in self.scope['references'].items(): shutil.copy2(REPO / source, self.root / target)
        changed = {name: digest(('new:' + name).encode()) for name in self.scope['requiredSource']}
        old_source = {name: digest(('old:' + name).encode()) for name in ['server/accounts.ts', 'server/index.ts', 'src/main.ts', 'src/i18n/en.ts']}
        old_source.update({'server/demoWallet.ts': digest(b'frozen engine'), 'package-lock.json': digest(b'dependencies')})
        for name in native_module.NATIVE_ROUND_SOURCES: old_source.setdefault(name, digest(('frozen:' + name).encode()))
        old_image, prepared = 'sha256:' + 'a' * 64, 'sha256:' + 'b' * 64
        before = {'sourceCommit': self.scope['base'], 'source': old_source, 'sourceLF': dict(old_source),
            'container': {'id': 'old-game', 'image': old_image, 'health': 'healthy', 'startedAt': 'then',
                'runtimeHash': digest(b'private runtime hash'), 'mounts': [], 'host': {'NetworkMode': 'royal_default'},
                'composeFiles': '/opt/royal/compose.yaml,/opt/royal/compose.override.yaml'},
            'program': {'dist/index.html': digest(b'old index'), 'dist/assets/old.js': digest(b'old asset'),
                'dist-server/index.js': digest(b'old backend'), 'dist-server/payments.js': digest(b'payments'),
                'dist-server/crypto-reconcile.js': digest(b'reconcile'), 'dist-server/card-engine': digest(b'Go engine'),
                'module-dist/old-game/active.json': digest(b'old module'), 'node_modules/a/index.js': digest(b'dependency'),
                'package-lock.json': digest(b'lock'), 'package.json': digest(b'package')},
            'configHashes': {'.env': digest(b'private environment')}, 'moduleFiles': {}, 'moduleHostContract': digest(b'contract'),
            'services': {'/royal-game-1': {'id': 'old-game'}, '/royal-payments-1': {'id': 'retained-service'}, '/royal-nile-play': {'id': 'retained-nile'}},
            'serviceProfiles': {'royal-game-1': {'id': 'old-game', 'profileSha256': digest(b'game profile')},
                'royal-payments-1': {'id': 'retained-service', 'profileSha256': digest(b'payments profile')},
                'royal-nile-play': {'id': 'retained-nile', 'profileSha256': digest(b'nile profile')}},
            'protectedPrograms': {'royal-nile-play': {'play.js': digest(b'nile program'), 'proof.js': digest(b'nile proof')}},
            'realMoneyFlags': None, 'preparedImage': prepared, 'availableBytes': 6 * 1024**3}
        before['preparedProgram'] = copy.deepcopy(before['program'])
        delta = {'index.html': digest(b'new index'), 'assets/new.js': digest(b'new asset')}
        server = {'index.js': digest(b'new backend')}
        config = {'productionCommit': self.scope['base']}
        (self.root / 'backend-projection.json').write_text(json.dumps(config))
        projection = {'config': 'deployment/releases/location-rewards-20261031-v2/backend-projection.json',
            'sha256': digest((self.root / 'backend-projection.json').read_bytes()), 'productionCommit': self.scope['base'],
            'entries': ['server/index.ts'], 'graphSha256': digest(b'bound complete graph'),
            'inputs': {'server/accounts.ts': changed['server/accounts.ts'], **{name: old_source[name] for name in native_module.NATIVE_ROUND_SOURCES}},
            'output': {'path': 'dist-server/index.js', 'sha256': server['index.js']}}
        projection['origins'] = {name: {'sha256': value} for name, value in projection['inputs'].items()}
        (self.root / 'backend-projection-report.json').write_text(json.dumps(projection))
        self.evidence = {native_module.NATIVE_RESTART_TEST: digest(b'reviewed restart test'),
            native_module.NATIVE_RESTART_HELPER: digest(b'reviewed projected loader')}
        native_report = {'format': 1, 'productionCommit': self.scope['base'],
            'featureCommit': '5120fa89698356a3deb9ee5788f45cd570a18154',
            'backendProjection': {name: projection[name] for name in ['config', 'sha256', 'graphSha256', 'output']},
            'sourceHashes': {name: projection['inputs'][name] for name in native_module.NATIVE_ROUND_SOURCES},
            'checks': {name: True for name in native_module.NATIVE_RESTART_CHECKS},
            'test': {'path': native_module.NATIVE_RESTART_TEST, 'sha256': self.evidence[native_module.NATIVE_RESTART_TEST],
                'helperPath': native_module.NATIVE_RESTART_HELPER, 'helperSha256': self.evidence[native_module.NATIVE_RESTART_HELPER], 'passed': True}}
        (self.root / 'native-round-compatibility.json').write_text(json.dumps(native_report))
        release = {'scope': 'application', 'sourceCommit': 'c' * 40, 'baseCommit': self.scope['base'],
            'build': {'passed': True, 'backendProjection': projection}, 'backendProjection': projection,
            'files': {**{'dist/' + name: sha for name, sha in delta.items()}, 'dist-server/index.js': server['index.js']}}
        (self.root / 'release-manifest.json').write_text(json.dumps(release))
        (self.root / 'release-github.json').write_text(json.dumps({'sourceCommit': 'c' * 40, 'remoteMain': 'c' * 40}))
        manifest = {'release': self.scope['release'], 'sourceCommit': 'c' * 40, 'baseCommit': self.scope['base'], 'before': before,
            'changed': changed, 'delta': delta, 'serverDelta': server,
            'helpers': {name: digest((self.root / name).read_bytes()) for name in ['overlay-base.py', 'financial_gate.py', 'quiesce-base.cjs', 'quiesce.cjs', 'runtime-inventory.cjs']},
            'helperSha256': digest((self.root / 'deploy.py').read_bytes()), 'snapshotSha256': digest((self.root / 'snapshot.py').read_bytes()),
            'scopeSha256': digest((self.root / 'scope.json').read_bytes()), 'releaseManifestSha256': digest((self.root / 'release-manifest.json').read_bytes()),
            'receiptSha256': digest((self.root / 'release-github.json').read_bytes()), 'backendProjectionSha256': digest((self.root / 'backend-projection-report.json').read_bytes()),
            'compatibility': {'hostContractVersionsUnchanged': True, 'bundledAndExternalModulesRetained': True, 'dependencyLockEquivalent': True,
                'featureSourceCommit': native_report['featureCommit'], 'nativeRoundsRestorable': True,
                'nativeRoundSources': native_report['sourceHashes'], 'nativeRoundCompatibilitySha256': digest((self.root / 'native-round-compatibility.json').read_bytes())}}
        (self.root / 'install-manifest.json').write_text(json.dumps(manifest))
        self.module = load(self.root / 'deploy.py', 'location_installer_test')
        self.base = self.module.configure(self.root)

    @contextmanager
    def payload_fixture(self):
        base, root = self.base, self.root
        expected = Path('/opt/royal-releases/location-rewards-20261031-v2')
        def local(path): return root / path.relative_to(expected)
        real_read, real_sha = self.module.read, self.module.sha
        real_file, real_link = Path.is_file, Path.is_symlink
        def mirror(path): return local(path) if path.is_relative_to(expected) else path
        original_root = base.ROOT; base.ROOT = expected
        inventories = {'source': base.CHANGES, 'dist-delta': base.DELTA, 'server-delta': base.SERVER_DELTA, 'verification': self.evidence}
        try:
            with patch.object(self.module, 'read', lambda path: real_read(local(path))), patch.object(self.module, 'sha', lambda path: real_sha(local(path))), patch.object(base, 'inventory', lambda path: inventories[path.name]), patch.object(Path, 'is_file', lambda path: real_file(mirror(path))), patch.object(Path, 'is_symlink', lambda path: real_link(mirror(path))):
                yield
        finally: base.ROOT = original_root

    def check_payload(self):
        with self.payload_fixture(): self.module.payload(self.base)

    def test_exact_verified_projection_and_narrow_overlay_pass(self):
        self.check_payload()
        expected = self.base.expected_program()
        for name, value in self.base.OLD['program'].items():
            if name not in ['dist/index.html', 'dist-server/index.js']: self.assertEqual(expected[name], value)
        self.assertIn('COPY --chown=node:node server-delta/ /app/dist-server/', self.module.dockerfile(self.base))
        self.assertNotIn('node_modules', self.module.dockerfile(self.base))

    def test_rejects_foreign_engine_source_and_missing_required_source(self):
        self.base.CHANGES['server/demoWallet.ts'] = digest(b'unreviewed math')
        with self.assertRaisesRegex(RuntimeError, 'Foreign'): self.check_payload()
        del self.base.CHANGES['server/demoWallet.ts']; del self.base.CHANGES['server/accounts.ts']
        with self.assertRaisesRegex(RuntimeError, 'incomplete'): self.check_payload()

    def test_rejects_other_backend_or_old_asset_replacement(self):
        self.base.SERVER_DELTA['payments.js'] = digest(b'unreviewed payment service')
        with self.assertRaisesRegex(RuntimeError, 'main backend'): self.check_payload()
        del self.base.SERVER_DELTA['payments.js']; self.base.DELTA['assets/old.js'] = digest(b'replaced immutable URL')
        with self.assertRaisesRegex(RuntimeError, 'Immutable'): self.check_payload()

    def test_refuses_stale_official_backend_bytes(self):
        file = self.root / 'release-manifest.json'; release = json.loads(file.read_text())
        release['files']['dist-server/index.js'] = '0' * 64; file.write_text(json.dumps(release))
        self.base.M['releaseManifestSha256'] = digest(file.read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'verified application artifact'): self.check_payload()

    def test_refuses_missing_or_changed_projection_input_provenance(self):
        file = self.root / 'backend-projection-report.json'; report = json.loads(file.read_text())
        report['inputs']['server/demoWallet.ts'] = '0' * 64; report['origins']['server/demoWallet.ts']['sha256'] = '0' * 64
        file.write_text(json.dumps(report)); self.base.M['backendProjectionSha256'] = digest(file.read_bytes())
        release_file = self.root / 'release-manifest.json'; release = json.loads(release_file.read_text())
        release['backendProjection'] = release['build']['backendProjection'] = report; release_file.write_text(json.dumps(release))
        self.base.M['releaseManifestSha256'] = digest(release_file.read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'installed source facts'): self.check_payload()

    def test_refuses_missing_required_native_engine_even_if_both_evidence_maps_omit_it(self):
        name = 'server/demoMines.ts'
        file = self.root / 'backend-projection-report.json'; projection = json.loads(file.read_text())
        del projection['inputs'][name]; del projection['origins'][name]
        file.write_text(json.dumps(projection)); self.base.M['backendProjectionSha256'] = digest(file.read_bytes())
        release_file = self.root / 'release-manifest.json'; release = json.loads(release_file.read_text())
        release['backendProjection'] = release['build']['backendProjection'] = projection; release_file.write_text(json.dumps(release))
        self.base.M['releaseManifestSha256'] = digest(release_file.read_bytes())
        native_file = self.root / 'native-round-compatibility.json'; native = json.loads(native_file.read_text())
        del native['sourceHashes'][name]; native_file.write_text(json.dumps(native))
        self.base.M['compatibility']['nativeRoundSources'] = native['sourceHashes']
        self.base.M['compatibility']['nativeRoundCompatibilitySha256'] = digest(native_file.read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'Native restart source inventory'): self.check_payload()

    def test_native_restart_checks_and_backend_are_bound_to_the_copied_report(self):
        file = self.root / 'native-round-compatibility.json'; original = json.loads(file.read_text())
        for change, message in [
            (lambda value: value['checks'].update({'sameSchemaRestart': False}), 'checks did not pass'),
            (lambda value: value['backendProjection']['output'].update({'sha256': '0' * 64}), 'backend differs'),
            (lambda value: value.update({'featureCommit': '0' * 40}), 'provenance differs'),
        ]:
            report = copy.deepcopy(original); change(report); file.write_text(json.dumps(report))
            self.base.M['compatibility']['nativeRoundCompatibilitySha256'] = digest(file.read_bytes())
            with self.assertRaisesRegex(RuntimeError, message): self.check_payload()

    def test_refuses_changed_native_report_or_restart_test_bytes(self):
        file = self.root / 'native-round-compatibility.json'; original = file.read_bytes()
        file.write_bytes(original + b'\n')
        with self.assertRaisesRegex(RuntimeError, 'Native restart evidence changed'): self.check_payload()
        file.write_bytes(original); self.evidence[self.module.NATIVE_RESTART_TEST] = digest(b'changed test')
        with self.assertRaisesRegex(RuntimeError, 'Native restart test bytes changed'): self.check_payload()

    def test_full_source_and_service_profiles_include_previously_unchecked_files(self):
        old = self.base.OLD
        self.assertEqual(self.base.sources({'source': {'server/x.ts.orig': 'kept'}}), {'server/x.ts.orig': 'kept'})
        current = copy.deepcopy(old); current['serviceProfiles']['royal-payments-1']['profileSha256'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'configuration changed'): self.base.settings(current)
        current = copy.deepcopy(old); current['protectedPrograms']['royal-nile-play']['play.js'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'program bytes changed'): self.base.settings(current)

    def test_protected_program_reader_accepts_only_listed_safe_code_names_and_known_services(self):
        helper = load(HERE / 'snapshot.py', 'location_protected_programs_test')
        before = copy.deepcopy(self.base.OLD); expected = before['protectedPrograms']['royal-nile-play']; commands = []
        def run(args): commands.append(args); return json.dumps(expected)
        with patch.object(helper, 'run', run): self.assertEqual(helper.protected_programs(before), before['protectedPrograms'])
        self.assertEqual(commands[0][2], 'royal-nile-play')
        for names in [{}, {'.env': '0' * 64}, {'../play.js': '0' * 64}, {'/app/play.js': '0' * 64}, {'data/player.js': '0' * 64}]:
            invalid = copy.deepcopy(before); invalid['protectedPrograms']['royal-nile-play'] = names
            with self.assertRaisesRegex(RuntimeError, 'Unsafe'): helper.protected_programs(invalid)
        del self.base.OLD['protectedPrograms']['royal-nile-play']
        with self.assertRaisesRegex(RuntimeError, 'Missing protected'): self.check_payload()

    def test_lease_is_released_before_waiting_for_new_backend_ddl_and_health(self):
        base = self.base; actions = []
        class Gate:
            def confirm(self): actions.append('confirm')
            def check(self): pass
            def run(self, args, **_kwargs): actions.append('compose' if 'compose' in args else 'tag')
            def release(self): actions.append('release')
            def close(self): actions.append('close')
        built = {'image': 'sha256:' + 'd' * 64, 'program': base.expected_program()}
        (self.root / 'build-result.json').write_text(json.dumps(built))
        state = copy.deepcopy(base.OLD); state['source'].update(base.CHANGES); state['container']['image'] = built['image']
        state['program'] = state['preparedProgram'] = built['program']; state['preparedImage'] = built['image']
        base.payload = lambda: None; base.baseline = lambda: None; base.image = lambda _ref: built['image']
        base.publication_backup = lambda _built: None; base.publication_capacity = lambda: None
        base.quiet_gate = lambda: Gate(); base.atomic = lambda *_args: actions.append('source')
        base.healthy = lambda: actions.append('healthy'); base.snapshot = lambda: state
        for name in base.DELTA:
            file = self.root / 'dist-delta' / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(b'delta')
        base.LIVE = self.root / 'live'; base.LIVE.mkdir()
        result = base.publish()
        self.assertTrue(result['published']); self.assertLess(actions.index('compose'), actions.index('release'))
        self.assertLess(actions.index('release'), actions.index('healthy'))

    def test_uncertain_docker_probe_is_not_treated_as_a_missing_game(self):
        helper = load(HERE / 'snapshot.py', 'location_snapshot_test')
        failed = subprocess.CompletedProcess([], 1, '', 'Cannot connect to Docker daemon')
        with patch.object(helper.subprocess, 'run', return_value=failed):
            with self.assertRaisesRegex(RuntimeError, 'uncertain'): helper.inspect_game(True)
        missing = subprocess.CompletedProcess([], 1, '', 'Error: No such object: royal-game-1')
        with patch.object(helper.subprocess, 'run', return_value=missing): self.assertIsNone(helper.inspect_game(True))
        other = subprocess.CompletedProcess([], 1, '', 'Error: No such object: another-container')
        with patch.object(helper.subprocess, 'run', return_value=other):
            with self.assertRaisesRegex(RuntimeError, 'uncertain'): helper.inspect_game(True)

    def test_game_identity_cannot_change_between_individual_and_bulk_docker_probes(self):
        helper = load(HERE / 'snapshot.py', 'location_snapshot_race_test')
        game = {'Name': '/royal-game-1', 'Id': 'old-id', 'Image': 'old-image', 'State': {'StartedAt': 'then', 'Status': 'running'}}
        helper.consistent_game_inspection(game, [copy.deepcopy(game)], False)
        changed = copy.deepcopy(game); changed['Id'] = 'replacement-id'
        with self.assertRaisesRegex(RuntimeError, 'identity changed'): helper.consistent_game_inspection(game, [changed], True)
        with self.assertRaisesRegex(RuntimeError, 'appeared'): helper.consistent_game_inspection(None, [game], True)
        with self.assertRaisesRegex(RuntimeError, 'disappeared'): helper.consistent_game_inspection(game, [], True)

    def test_module_and_contract_symlinks_are_rejected_even_when_added_under_new_names(self):
        helper = load(HERE / 'snapshot.py', 'location_snapshot_symlinks_test')
        root = (self.root / 'modules').resolve(); root.mkdir(); (root / 'entry.js').write_text('original module')
        self.assertEqual(len(helper.module_inventory(root)), 1)
        (root / 'new-name.js').symlink_to(root / 'entry.js')
        with self.assertRaisesRegex(RuntimeError, 'symlink'): helper.module_inventory(root)
        contract = (self.root / 'host.json').resolve(); contract.write_text('{"games":{}}')
        linked = (self.root / 'linked-host.json').resolve(); linked.symlink_to(contract)
        with self.assertRaisesRegex(RuntimeError, 'host contract'): helper.host_contract(linked)

    def test_disk_reserve_includes_backend_delta_and_bounded_database_backup(self):
        base = self.base; base.payload = lambda: None
        old = copy.deepcopy(base.OLD); old['availableBytes'] = self.module.MIN_FREE + 63 * 1024**2
        base.baseline = lambda: old; base.BACKUP = self.root / 'backup'
        for folder, rows in [('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)]:
            for name in rows:
                file = self.root / folder / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(b'delta')
        with self.assertRaisesRegex(RuntimeError, 'bounded backup reserve'): self.module.build(base)
        self.assertFalse(base.BACKUP.exists())

    def test_source_backup_contains_only_changed_existing_sources(self):
        base = self.base; base.LIVE = self.root / 'live'; base.LIVE.mkdir(); base.BACKUP = self.root / 'backup'; base.BACKUP.mkdir()
        for name in set(base.CHANGES) & set(base.OLD['source']):
            path = base.LIVE / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('old:' + name)
        base.backup_sources(1024**2); base.verify_tar(base.BACKUP / 'source.tgz')
        with tarfile.open(base.BACKUP / 'source.tgz') as archive:
            self.assertEqual(set(m.name for m in archive.getmembers()), set(base.CHANGES) & set(base.OLD['source']))
            self.assertNotIn('server/demoWallet.ts', archive.getnames())

    def test_rollback_adoption_guard_runs_before_source_restore(self):
        base = self.base
        base.payload = lambda: None
        expected = {'dist/index.html': digest(b'candidate')}
        (self.root / 'build-result.json').write_text(json.dumps({'program': expected}))
        base.expected_program = lambda: expected
        base.snapshot = lambda recovery=False: {'container': None}
        base.recovery_guard = lambda current, built: None
        base.backup_guard = lambda built: None
        with patch.object(self.module, 'quiet_gate', side_effect=RuntimeError('adopted v2 rights')), patch.object(base, 'atomic') as atomic:
            with self.assertRaisesRegex(RuntimeError, 'adopted v2 rights'):
                base.rollback()
            atomic.assert_not_called()
        self.assertFalse(base.reward_downgrade)
        self.assertIn('ROYAL_REWARDS_DOWNGRADE=false', self.module.gate_program(base))
        base.reward_downgrade = True
        self.assertIn('ROYAL_REWARDS_DOWNGRADE=true', self.module.gate_program(base))

    def test_empty_adoption_rollback_restores_only_reviewed_source_and_index_under_the_fence(self):
        base = self.base; events = []
        base.LIVE = self.root / 'live'; base.BACKUP = self.root / 'backup'
        (base.LIVE / 'server/progression').mkdir(parents=True); (base.LIVE / 'dist').mkdir(); base.BACKUP.mkdir()
        account = base.LIVE / 'server/accounts.ts'; account.write_bytes(b'new account source')
        added = base.LIVE / 'server/progression/skinGenerations.ts'; added.write_bytes(b'new service')
        (base.LIVE / '.env').write_bytes(b'fixture configuration')
        old = self.root / 'old-account'; old.write_bytes(b'old account source')
        with tarfile.open(base.BACKUP / 'source.tgz', 'w:gz') as archive:
            archive.add(old, arcname='server/accounts.ts')
        (base.BACKUP / 'index.html').write_bytes(b'old index')
        base.BASE = {'server/accounts.ts': digest(b'old account source')}
        base.CHANGES = {'server/accounts.ts': digest(b'new account source'), 'server/progression/skinGenerations.ts': digest(b'new service')}
        expected = {'dist/index.html': digest(b'candidate')}
        base.OLD = {'preparedImage': 'old-image', 'program': {'dist/index.html': digest(b'old index')}}
        base.OLD['preparedProgram'] = dict(base.OLD['program'])
        (self.root / 'build-result.json').write_text(json.dumps({'program': expected}))
        base.expected_program = lambda: expected; base.payload = lambda: None
        base.snapshot = lambda recovery=False: {'container': None} if recovery else {'source': base.BASE, **base.OLD}
        base.recovery_guard = lambda current, built: None; base.backup_guard = lambda built: None
        base.settings = lambda state: None; base.healthy = lambda: None
        base.compose = lambda gate: events.append('compose'); base.write = lambda name, value: events.append(name)
        class Gate:
            def confirm(self): events.append('confirm')
            def run(self, command): events.append(command)
            def release(self): events.append('release')
            def close(self): events.append('close')
        with patch.object(self.module, 'quiet_gate', return_value=Gate()):
            result = base.rollback()
        self.assertTrue(result['restored']); self.assertFalse(result['databaseTouched'])
        self.assertEqual(account.read_bytes(), b'old account source'); self.assertFalse(added.exists())
        self.assertEqual((base.LIVE / 'dist/index.html').read_bytes(), b'old index')
        self.assertEqual((base.LIVE / '.env').read_bytes(), b'fixture configuration')
        self.assertLess(events.index('confirm'), events.index('compose'))
        self.assertLess(events.index('release'), events.index('close'))


class ServiceProfileTests(unittest.TestCase):
    def test_environment_order_is_immaterial_but_values_and_duplicate_keys_are_checked(self):
        module = load(HERE / 'snapshot.py', 'reward_snapshot_profile')
        row = {'Config': {'Env': ['A=1', 'B=2'], 'User': 'node'}, 'HostConfig': {},
               'Mounts': [], 'NetworkSettings': {'Networks': {'royal_default': {}}}}
        expected = module.profile_sha(row)
        row['Config']['Env'].reverse()
        self.assertEqual(module.profile_sha(row), expected)
        row['Config']['Env'] = ['A=1', 'B=3']
        self.assertNotEqual(module.profile_sha(row), expected)
        row['Config']['Env'] = ['A=1', 'A=2']
        with self.assertRaisesRegex(RuntimeError, 'Duplicate'):
            module.profile_sha(row)


if __name__ == '__main__': unittest.main()
