import importlib.util, sys, types, unittest
from pathlib import Path
sys.dont_write_bytecode = True
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.SimpleNamespace())
HERE = Path(__file__).resolve().parent
sys.path.append(str(HERE.parent / 'remove-reward-games-catalog-20261031-v1'))
spec = importlib.util.spec_from_file_location('elevator_deploy', HERE / 'deploy.py')
deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)
spec = importlib.util.spec_from_file_location('elevator_configure', HERE / 'configure.py')
configure = importlib.util.module_from_spec(spec); spec.loader.exec_module(configure)

class ElevatorScopeTest(unittest.TestCase):
    def fixture(self):
        changes = {name: 'reviewed-' + name for name in deploy.SOURCES}
        before = {'source': {'src/wallet/WalletClient.ts': 'wallet'}, 'sourceLF': {'src/wallet/WalletClient.ts': 'wallet'}}
        projection = {'inputs': {**changes, 'src/wallet/WalletClient.ts': 'wallet'}}
        return changes, projection, before
    def test_reviewed_sources_with_unchanged_wallet(self):
        deploy.validate_inputs(*self.fixture(), deploy.SOURCES)
    def test_missing_and_extra_source_rejected(self):
        for extra in [True, False]:
            changes, projection, before = self.fixture()
            if extra: changes['src/shared/arcadeCatalog.ts'] = 'other'
            else: changes.pop('src/shared/elevator.ts')
            with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, deploy.SOURCES)
    def test_changed_wallet_rejected(self):
        changes, projection, before = self.fixture()
        projection['inputs']['src/wallet/WalletClient.ts'] = 'changed'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, deploy.SOURCES)
    def test_missing_required_input_rejected(self):
        changes, projection, before = self.fixture()
        projection['inputs'].pop('src/shared/elevator.ts')
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, deploy.SOURCES)
    def test_backend_dictionary_exactly_pinned(self):
        changes, projection, before = self.fixture()
        projection['inputs']['src/i18n/en.ts'] = deploy.PRESERVED_BACKEND_INPUTS['src/i18n/en.ts']
        deploy.validate_inputs(changes, projection, before, {'server/LobbyRoom.ts'}, deploy.PRESERVED_BACKEND_INPUTS)
        projection['inputs']['src/i18n/en.ts'] = 'other'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, {'server/LobbyRoom.ts'}, deploy.PRESERVED_BACKEND_INPUTS)
    def test_overlay_preserves_unpublished_features_absence(self):
        old = 'function interact() {\n  if (locked) return;\n  unpublishedPlayerMenu();\n  atelier();\n}\n'
        new = old.replace('  unpublishedPlayerMenu();', '  elevator();\n  unpublishedPlayerMenu();')
        live = old.replace('  unpublishedPlayerMenu();\n', '')
        result, patches = configure.overlay(old, new, live)
        self.assertEqual(result, live.replace('  atelier();', '  elevator();\n  atelier();'))
        self.assertNotIn('unpublishedPlayerMenu', result)
        for patch in patches:
            self.assertEqual(live.count(patch['from']), 1)
            live = live.replace(patch['from'], patch['to'], 1)
        self.assertEqual(live, result)
    def test_missing_changed_statement_rejected(self):
        with self.assertRaises(RuntimeError): configure.overlay('oldPaymentRule();\n', 'newPaymentRule();\n', 'currentPaymentRule();\n')

if __name__ == '__main__': unittest.main()
