import importlib.util, sys, types, unittest
from pathlib import Path
sys.dont_write_bytecode = True
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec = importlib.util.spec_from_file_location('cat_idle_deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)

class CatScopeTest(unittest.TestCase):
    def fixture(self):
        changes = {name: 'cat-' + name for name in deploy.SOURCES}
        before = {'source': {'src/shared/arcadeCatalog.ts': 'catalogue', 'src/wallet/WalletClient.ts': 'wallet'}, 'sourceLF': {}}
        graph = {'inputs': {**changes, **before['source']}}
        return changes, {}, graph, before
    def test_cat_only_change_is_allowed(self): deploy.validate_scope(*self.fixture())
    def test_backend_change_is_rejected(self):
        changes, _, graph, before = self.fixture()
        with self.assertRaises(RuntimeError): deploy.validate_scope(changes, {'index.js': 'changed'}, graph, before)
    def test_catalogue_and_wallet_changes_are_rejected(self):
        for name in ['src/shared/arcadeCatalog.ts', 'src/wallet/WalletClient.ts']:
            changes, server, graph, before = self.fixture(); graph['inputs'][name] = 'changed'
            with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)
    def test_unknown_and_missing_sources_are_rejected(self):
        for name in ['src/game/CatIdleMotion.ts', 'src/shared/arcadeCatalog.ts']:
            changes, server, graph, before = self.fixture()
            if name in changes: changes.pop(name)
            else: changes[name] = 'changed'
            with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)
    def test_new_unbound_source_is_rejected(self):
        changes, server, graph, before = self.fixture(); graph['inputs'].pop('src/game/CatIdleMotion.ts')
        with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)

if __name__ == '__main__': unittest.main()
