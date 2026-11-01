import sys, unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.append(str(HERE.parent/'remove-reward-games-catalog-20261031-v1'))
import deploy

class LayoutGuards(unittest.TestCase):
    def fixture(self):
        changes={n:'reviewed-'+n for n in deploy.SOURCES}
        before={'source':{'src/wallet/WalletClient.ts':'wallet'},'sourceLF':{'src/wallet/WalletClient.ts':'wallet'}}
        return changes,{'inputs':{**changes,'src/wallet/WalletClient.ts':'wallet'}},before
    def test_reviewed_layout_preserves_wallet(self): deploy.validate_inputs(*self.fixture())
    def test_unknown_or_missing_source_rejected(self):
        for missing in [True,False]:
            changes,graph,before=self.fixture()
            if missing:changes.pop(next(iter(changes)))
            else:changes['server/demoWallet.ts']='foreign'
            with self.assertRaises(RuntimeError):deploy.validate_inputs(changes,graph,before)
    def test_unrelated_runtime_input_rejected(self):
        changes,graph,before=self.fixture();graph['inputs']['src/wallet/WalletClient.ts']='foreign'
        with self.assertRaises(RuntimeError):deploy.validate_inputs(changes,graph,before)
    def test_required_layout_entry_must_be_bound(self):
        changes,graph,before=self.fixture();graph['inputs'].pop('src/main.ts')
        with self.assertRaises(RuntimeError):deploy.validate_inputs(changes,graph,before,{'src/main.ts'})
    def test_module_inventory_preserves_old_immutable_bytes(self):
        m={'before':{'moduleFiles':{'old-resource':'old','/opt/royal-game-modules/a/active.json':'before'}},'packages':{'a':{'version':'1.0.0-123456789abc','files':{'manifest.json':'manifest','entry.js':'entry'},'pointerSha256':'after'}}}
        result=deploy.expected_modules(m)
        self.assertEqual(result['old-resource'],'old');self.assertEqual(result['/opt/royal-game-modules/a/active.json'],'after')
        self.assertEqual(result['/opt/royal-game-modules/a/versions/1.0.0-123456789abc/entry.js'],'entry')
    def test_complete_release_keeps_host_before_clients(self):
        calls=[]
        b=SimpleNamespace(build=lambda:calls.append('build'),publish=lambda:calls.append('host'))
        with patch.object(deploy,'backup_modules',side_effect=lambda _:calls.append('backup')),patch.object(deploy,'publish_modules',side_effect=lambda _:calls.append('clients')):
            deploy.release_all(b)
        self.assertEqual(calls,['build','backup','host','clients'])
    def test_failed_build_prevents_any_publication(self):
        def fail():raise RuntimeError('Stale baseline')
        b=SimpleNamespace(build=fail,publish=unittest.mock.Mock())
        with patch.object(deploy,'backup_modules') as backup,patch.object(deploy,'publish_modules') as clients:
            with self.assertRaisesRegex(RuntimeError,'Stale baseline'):deploy.release_all(b)
        backup.assert_not_called();clients.assert_not_called();b.publish.assert_not_called()

if __name__=='__main__':unittest.main()
