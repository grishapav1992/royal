import importlib.util, json, sys, tempfile, types, unittest
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode = True
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.SimpleNamespace())
HERE = Path(__file__).resolve().parent
sys.path.append(str(HERE.parent / 'remove-reward-games-catalog-20261031-v1'))
spec = importlib.util.spec_from_file_location('pvp_offer_deploy', HERE / 'deploy.py')
deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)

class SourceBindingTest(unittest.TestCase):
    def fixture(self):
        changes = {name: 'reviewed-' + name for name in deploy.SOURCES}
        before = {'source': {'src/wallet/WalletClient.ts':'wallet'}, 'sourceLF': {'src/wallet/WalletClient.ts':'wallet'}}
        return changes, {'inputs': {**changes,'src/wallet/WalletClient.ts':'wallet'}}, before
    def test_only_offer_sources_and_bound_evidence_are_accepted(self):
        deploy.validate_inputs(*self.fixture(), deploy.HOST_INPUTS)
    def test_extra_source_is_rejected(self):
        changes, graph, before = self.fixture(); changes['src/shared/unrelated.ts']='extra'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes,graph,before,deploy.HOST_INPUTS)
    def test_missing_qualification_source_is_rejected(self):
        changes, graph, before = self.fixture(); changes.pop('scripts/game-math/tsu-duel-wallet.ts')
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes,graph,before,deploy.HOST_INPUTS)
    def test_changed_wallet_is_rejected(self):
        changes, graph, before = self.fixture(); graph['inputs']['src/wallet/WalletClient.ts']='changed'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes,graph,before,deploy.HOST_INPUTS)
    def test_missing_offer_input_is_rejected(self):
        changes, graph, before = self.fixture(); graph['inputs'].pop('src/ui/PvpUI.ts')
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes,graph,before,deploy.HOST_INPUTS)
    def test_preserved_backend_dictionary_is_exact(self):
        changes, graph, before = self.fixture(); graph['inputs'].update(deploy.PRESERVED_BACKEND_INPUTS)
        deploy.validate_inputs(changes,graph,before,deploy.BACKEND_INPUTS,deploy.PRESERVED_BACKEND_INPUTS)
        graph['inputs']['src/i18n/en.ts']='another'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes,graph,before,deploy.BACKEND_INPUTS,deploy.PRESERVED_BACKEND_INPUTS)

class HealthTest(unittest.TestCase):
    def run_health(self, healthy_at=90, endpoint=True, running=True, timeout=300):
        clock=[0];checks=[]
        def run(args):
            checks.append(args)
            if args[1]=='inspect': return json.dumps([{'State':{'Running':running,'Health':{'Status':'healthy' if clock[0]>=healthy_at else 'starting'}}}])
            return json.dumps({'ok':endpoint})
        deploy.wait_for_healthy(types.SimpleNamespace(run=run),timeout=timeout,now=lambda:clock[0],pause=lambda seconds:clock.__setitem__(0,clock[0]+seconds))
        return clock[0],checks
    def test_waits_for_docker_health_and_fresh_endpoint(self):
        elapsed,checks=self.run_health();self.assertEqual(elapsed,90);self.assertEqual(checks[-1][1],'exec')
    def test_exited_container_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'exited'):self.run_health(running=False)
    def test_bad_health_endpoint_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'endpoint'):self.run_health(healthy_at=0,endpoint=False)
    def test_wait_is_bounded(self):
        with self.assertRaisesRegex(RuntimeError,'deadline'):self.run_health(healthy_at=301)

@unittest.skipIf(sys.platform=='win32','Real fcntl checks require Linux')
class PublicationLocksTest(unittest.TestCase):
    def test_busy_third_lock_releases_every_partial_acquisition(self):
        import fcntl
        with tempfile.TemporaryDirectory() as folder:
            names=[str(Path(folder)/str(n)) for n in range(3)]
            with open(names[2],'a') as busy:
                fcntl.flock(busy,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with patch.object(deploy,'LOCKS',names):
                    with self.assertRaises(deploy.PublicationBusy):
                        with deploy.publication_locks():self.fail('Busy publication entered the installer')
                for name in names[:2]:
                    with open(name,'a') as handle:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
    def test_success_releases_locks_on_exception(self):
        import fcntl
        with tempfile.TemporaryDirectory() as folder:
            names=[str(Path(folder)/str(n)) for n in range(3)]
            with patch.object(deploy,'LOCKS',names):
                with self.assertRaisesRegex(RuntimeError,'stop'):
                    with deploy.publication_locks():raise RuntimeError('stop')
            for name in names:
                with open(name,'a') as handle:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)

if __name__=='__main__':unittest.main()
