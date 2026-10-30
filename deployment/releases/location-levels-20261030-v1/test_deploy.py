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
        self.root = Path(self.temp.name)
        self.scope = json.loads((HERE / 'scope.json').read_text())
        for name in ['deploy.py', 'snapshot.py', 'scope.json', 'quiesce.cjs']: shutil.copy2(HERE / name, self.root / name)
        for target, source in self.scope['references'].items(): shutil.copy2(REPO / source, self.root / target)
        changed = {name: digest(('new:' + name).encode()) for name in self.scope['requiredSource']}
        old_source = {name: digest(('old:' + name).encode()) for name in ['server/accounts.ts', 'server/index.ts', 'src/main.ts', 'src/i18n/en.ts']}
        old_source.update({'server/demoWallet.ts': digest(b'frozen engine'), 'package-lock.json': digest(b'dependencies')})
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
        projection = {'config': 'deployment/releases/location-levels-20261030-v1/backend-projection.json',
            'sha256': digest((self.root / 'backend-projection.json').read_bytes()), 'productionCommit': self.scope['base'],
            'entries': ['server/index.ts'], 'inputs': {'server/accounts.ts': changed['server/accounts.ts'], 'server/demoWallet.ts': old_source['server/demoWallet.ts']},
            'origins': {'server/accounts.ts': {'sha256': changed['server/accounts.ts']}, 'server/demoWallet.ts': {'sha256': old_source['server/demoWallet.ts']}},
            'output': {'path': 'dist-server/index.js', 'sha256': server['index.js']}}
        (self.root / 'backend-projection-report.json').write_text(json.dumps(projection))
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
            'compatibility': {'hostContractVersionsUnchanged': True, 'bundledAndExternalModulesRetained': True, 'dependencyLockEquivalent': True}}
        (self.root / 'install-manifest.json').write_text(json.dumps(manifest))
        self.module = load(self.root / 'deploy.py', 'location_installer_test')
        self.base = self.module.configure(self.root)

    @contextmanager
    def payload_fixture(self):
        base, root = self.base, self.root
        expected = Path('/opt/royal-releases/location-levels-20261030-v1')
        def local(path): return root / path.relative_to(expected)
        real_read, real_sha = self.module.read, self.module.sha
        real_file, real_link = Path.is_file, Path.is_symlink
        def mirror(path): return local(path) if path.is_relative_to(expected) else path
        original_root = base.ROOT; base.ROOT = expected
        inventories = {'source': base.CHANGES, 'dist-delta': base.DELTA, 'server-delta': base.SERVER_DELTA}
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


if __name__ == '__main__': unittest.main()
