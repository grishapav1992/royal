import importlib.util,sys,types,unittest
from pathlib import Path
sys.dont_write_bytecode=True
if sys.platform=='win32':sys.modules.setdefault('fcntl',types.SimpleNamespace())
spec=importlib.util.spec_from_file_location('tsu_deploy',Path(__file__).with_name('deploy.py'))
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
class ScopeGuards(unittest.TestCase):
    def fixture(self):
        before={'source':{'store':'old','wallet':'wallet'},'sourceLF':{'store':'old','wallet':'wallet'}}
        return {'productionCommit':'base','inputs':{'store':'new','wallet':'wallet'}},{'baseCommit':'base','before':before},{'expectedSources':{'store':'new'},'preservedBackendInputs':{'dictionary':'published'}}
    def test_reviewed_change_with_preserved_wallet(self):deploy.validate_graph(*self.fixture())
    def test_changed_source_cannot_silently_use_old_bytes(self):
        graph,m,scope=self.fixture();graph['inputs']['store']='old'
        with self.assertRaises(RuntimeError):deploy.validate_graph(graph,m,scope)
    def test_unrequested_wallet_change_rejected(self):
        graph,m,scope=self.fixture();graph['inputs']['wallet']='other'
        with self.assertRaises(RuntimeError):deploy.validate_graph(graph,m,scope)
    def test_missing_origin_rejected(self):
        graph,m,scope=self.fixture();graph['inputs']['unknown']='unreviewed'
        with self.assertRaises(RuntimeError):deploy.validate_graph(graph,m,scope)
    def test_wrong_production_base_rejected(self):
        graph,m,scope=self.fixture();graph['productionCommit']='other'
        with self.assertRaises(RuntimeError):deploy.validate_graph(graph,m,scope)
    def test_inherited_dictionary_pin_is_backend_only(self):
        graph,m,scope=self.fixture();graph['inputs']['dictionary']='published'
        deploy.validate_graph(graph,m,scope,True)
        with self.assertRaises(RuntimeError):deploy.validate_graph(graph,m,scope,False)
    def test_new_package_does_not_replace_existing_game_paths(self):
        m={'before':{'moduleFiles':{'old-game/active.json':'old'}},'package':{'version':'1.3.2-reviewed','files':{'manifest.json':'manifest'},'pointerSha256':'pointer'}}
        actual=deploy.expected_modules(m);self.assertEqual(actual['old-game/active.json'],'old')
        self.assertEqual(actual['/opt/royal-game-modules/tsu-e-fa/active.json'],'pointer')
if __name__=='__main__':unittest.main()
