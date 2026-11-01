import sys, unittest
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.append(str(Path(__file__).resolve().parent.parent / 'remove-reward-games-catalog-20261031-v1'))
import deploy

class GuardScopeTest(unittest.TestCase):
    def fixture(self):
        changes = {name: 'reviewed-' + name for name in deploy.SOURCES}
        before = {'source': {'src/wallet/WalletClient.ts': 'wallet'}, 'sourceLF': {'src/wallet/WalletClient.ts': 'wallet'}}
        projection = {'inputs': {**changes, 'src/wallet/WalletClient.ts': 'wallet'}}
        return changes, projection, before, deploy.SOURCES
    def test_guard_only_with_unchanged_wallet(self):
        deploy.validate_inputs(*self.fixture())
    def test_missing_or_extra_source_is_rejected(self):
        for extra in [True, False]:
            changes, projection, before, required = self.fixture()
            if extra: changes['src/shared/arcadeCatalog.ts'] = 'other'
            else: changes.pop('server/guards.ts')
            with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, required)
    def test_unrelated_bundle_change_is_rejected(self):
        changes, projection, before, required = self.fixture()
        projection['inputs']['src/wallet/WalletClient.ts'] = 'changed'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, required)
    def test_unbound_guard_input_is_rejected(self):
        changes, projection, before, required = self.fixture()
        projection['inputs'].pop('server/guards.ts')
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, required)
    def test_inherited_backend_dictionary_is_pinned(self):
        changes, projection, before, required = self.fixture()
        projection['inputs']['src/i18n/en.ts'] = deploy.PRESERVED_BACKEND_INPUTS['src/i18n/en.ts']
        deploy.validate_inputs(changes, projection, before, {'server/guards.ts'}, deploy.PRESERVED_BACKEND_INPUTS)
        projection['inputs']['src/i18n/en.ts'] = 'other'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, {'server/guards.ts'}, deploy.PRESERVED_BACKEND_INPUTS)
    def test_only_approved_backend_line_can_change(self):
        old = b'// royal-backend-projection old\n' + '    g.speech = count2 === 9 ? "Ещё один толчок, и на выход. 9/10." : `Не толкайся. ${count2}/10.`;\nunchanged();\n'.encode()
        new = b'// royal-backend-projection new\n' + '    g.speech = count2 === 9 ? "Ещё один толчок, и на выход." : "Не толкайся.";\nunchanged();\n'.encode()
        deploy.validate_backend_bytes(old, new)
        for changed in [new.replace(b'unchanged()', b'other()'), new.replace(b'count2 === 9', b'count2 === 8'), new + b'added();\n']:
            with self.assertRaises(RuntimeError): deploy.validate_backend_bytes(old, changed)

if __name__ == '__main__': unittest.main()
