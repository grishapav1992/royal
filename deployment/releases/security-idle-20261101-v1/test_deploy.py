import sys, unittest
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.append(str(Path(__file__).resolve().parent.parent / 'remove-reward-games-catalog-20261031-v1'))
import deploy

class HeaderScopeTest(unittest.TestCase):
    def fixture(self):
        changes = {name: 'reviewed-' + name for name in deploy.SOURCES}
        before = {'source': {'src/wallet/WalletClient.ts': 'wallet'}, 'sourceLF': {'src/wallet/WalletClient.ts': 'wallet'}}
        projection = {'inputs': {**changes, 'src/wallet/WalletClient.ts': 'wallet'}}
        return changes, projection, before
    def test_header_only_with_unchanged_wallet(self):
        deploy.validate_inputs(*self.fixture())
    def test_missing_or_extra_source_is_rejected(self):
        for extra in [True, False]:
            changes, projection, before = self.fixture()
            if extra: changes['src/shared/arcadeCatalog.ts'] = 'other'
            else: changes.pop('src/network/LobbyClient.ts')
            with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before)
    def test_unrelated_bundle_change_is_rejected(self):
        changes, projection, before = self.fixture()
        projection['inputs']['src/wallet/WalletClient.ts'] = 'changed'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before)
    def test_unbound_header_input_is_rejected(self):
        changes, projection, before = self.fixture()
        projection['inputs'].pop('src/network/LobbyClient.ts')
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before)

if __name__ == '__main__': unittest.main()
