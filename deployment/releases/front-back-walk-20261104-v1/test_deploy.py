import copy, importlib.util, sys, types, unittest
from pathlib import Path
sys.dont_write_bytecode = True
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec = importlib.util.spec_from_file_location('profile_walk_deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)

class ProfileScopeTest(unittest.TestCase):
    def fixture(self):
        changes = {name: 'profile-' + name for name in deploy.SOURCES}
        before = {'source': {'src/shared/arcadeCatalog.ts': 'catalogue', 'src/wallet/WalletClient.ts': 'wallet'}, 'sourceLF': {}}
        graph = {'inputs': {**changes, **before['source']}}
        return changes, {}, graph, before
    def test_profile_only_change_is_allowed(self): deploy.validate_scope(*self.fixture())
    def test_backend_change_is_rejected(self):
        changes, _, graph, before = self.fixture()
        with self.assertRaises(RuntimeError): deploy.validate_scope(changes, {'index.js': 'changed'}, graph, before)
    def test_catalogue_and_wallet_changes_are_rejected(self):
        for name in ['src/shared/arcadeCatalog.ts', 'src/wallet/WalletClient.ts']:
            changes, server, graph, before = self.fixture(); graph['inputs'][name] = 'changed'
            with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)
    def test_unknown_and_missing_sources_are_rejected(self):
        for name in ['src/game/frontalWalk.ts', 'src/shared/arcadeCatalog.ts']:
            changes, server, graph, before = self.fixture()
            if name in changes: changes.pop(name)
            else: changes[name] = 'changed'
            with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)
    def test_new_unbound_source_is_rejected(self):
        changes, server, graph, before = self.fixture(); graph['inputs'].pop('src/game/frontalWalk.ts')
        with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)

    def advance_fixture(self):
        prepared = {'sourceCommit': 'old', 'sourceRevision': 'old', 'source': {'drawing': 'same', 'backend': 'old'},
                    'sourceLF': {'drawing': 'same', 'backend': 'old'}, 'program': {'dist/index.html': 'same', 'dist-server/index.js': 'old'},
                    'preparedProgram': {'dist/index.html': 'same', 'dist-server/index.js': 'old'}, 'moduleFiles': {'old-module': 'same'},
                    'container': {'id': 'old', 'image': 'old-image', 'startedAt': 1, 'health': 'healthy', 'runtimeHash': 'same', 'mounts': [], 'host': {}, 'composeFiles': 'same'},
                    'preparedImage': 'old-image', 'services': {'/royal-game-1': 'old', '/database': 'same'},
                    'serviceProfiles': {'royal-game-1': {'profileSha256': 'same', 'id': 'old'}, 'database': {'id': 'same'}},
                    'configHashes': {'wallet': 'same'}, 'moduleHostContract': 'same', 'protectedPrograms': {'finance': 'same'}, 'at': 1, 'availableBytes': 10}
        allowed = {'release': 'star-spin-open-selection-20261104-v1', 'sourceCommit': 'new', 'sourceChanges': {'backend': 'new'},
                   'serverDelta': {'index.js': 'new'}, 'moduleFiles': {'new-module': 'new'}}
        evidence = {**allowed, 'image': 'new-image'}
        current = copy.deepcopy(prepared)
        for key in ['source', 'sourceLF']: current[key].update(allowed['sourceChanges'])
        for key in ['program', 'preparedProgram']: current[key]['dist-server/index.js'] = 'new'
        current['moduleFiles'].update(allowed['moduleFiles'])
        current.update(sourceCommit='new', sourceRevision='new', preparedImage='new-image', at=2, availableBytes=9)
        current['container'].update(id='new', image='new-image', startedAt=2)
        current['services']['/royal-game-1'] = 'new'; current['serviceProfiles']['royal-game-1']['id'] = 'new'
        return prepared, current, evidence, allowed

    def test_exact_reviewed_backend_and_module_advance_is_preserved(self):
        deploy.validate_runtime_advance(*self.advance_fixture())

    def test_unrelated_runtime_changes_are_rejected(self):
        for key, name in [('source', 'drawing'), ('program', 'dist/index.html'), ('moduleFiles', 'old-module'),
                          ('configHashes', 'wallet'), ('protectedPrograms', 'finance')]:
            prepared, current, evidence, allowed = self.advance_fixture(); current[key][name] = 'foreign'
            with self.assertRaises(RuntimeError): deploy.validate_runtime_advance(prepared, current, evidence, allowed)
        prepared, current, evidence, allowed = self.advance_fixture(); current['moduleHostContract'] = 'incompatible'
        with self.assertRaises(RuntimeError): deploy.validate_runtime_advance(prepared, current, evidence, allowed)

    def test_unbound_concurrent_evidence_is_rejected(self):
        prepared, current, evidence, allowed = self.advance_fixture(); evidence['serverDelta'] = {'index.js': 'foreign'}
        with self.assertRaises(RuntimeError): deploy.validate_runtime_advance(prepared, current, evidence, allowed)

if __name__ == '__main__': unittest.main()


