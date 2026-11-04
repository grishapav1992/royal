import importlib.util, json, sys, types, unittest
from pathlib import Path
sys.dont_write_bytecode = True
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.SimpleNamespace())
HERE = Path(__file__).resolve().parent
sys.path.append(str(HERE.parent / 'remove-reward-games-catalog-20261031-v1'))
spec = importlib.util.spec_from_file_location('elevator_deploy', HERE / 'deploy.py')
deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)

class ConnectionScopeTest(unittest.TestCase):
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
            if extra: changes['src/shared/unrelated.ts'] = 'other'
            else: changes.pop('src/shared/playerRecovery.ts')
            with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, deploy.SOURCES)
    def test_changed_wallet_rejected(self):
        changes, projection, before = self.fixture()
        projection['inputs']['src/wallet/WalletClient.ts'] = 'changed'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, deploy.SOURCES)
    def test_missing_required_input_rejected(self):
        changes, projection, before = self.fixture()
        projection['inputs'].pop('src/shared/playerRecovery.ts')
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, deploy.SOURCES)
    def test_backend_dictionary_exactly_pinned(self):
        changes, projection, before = self.fixture()
        projection['inputs']['src/i18n/en.ts'] = deploy.PRESERVED_BACKEND_INPUTS['src/i18n/en.ts']
        deploy.validate_inputs(changes, projection, before, {'server/LobbyRoom.ts'}, deploy.PRESERVED_BACKEND_INPUTS)
        projection['inputs']['src/i18n/en.ts'] = 'other'
        with self.assertRaises(RuntimeError): deploy.validate_inputs(changes, projection, before, {'server/LobbyRoom.ts'}, deploy.PRESERVED_BACKEND_INPUTS)

class StartupHealthTest(unittest.TestCase):
    def run_health(self, healthy_at=90, endpoint=True, running=True, timeout=300):
        clock = [0]
        checks = []
        def run(args):
            checks.append(args)
            if args[1] == 'inspect':
                return json.dumps([{'State': {'Running': running, 'Health': {'Status': 'healthy' if clock[0] >= healthy_at else 'starting'}}}])
            return json.dumps({'ok': endpoint})
        deploy.wait_for_healthy(types.SimpleNamespace(run=run), timeout=timeout, now=lambda: clock[0], pause=lambda seconds: clock.__setitem__(0,clock[0]+seconds))
        return clock[0], checks
    def test_slow_valid_startup_waits_for_docker_and_endpoint(self):
        elapsed, checks = self.run_health()
        self.assertEqual(elapsed,90)
        self.assertEqual(checks[-1][1],'exec')
    def test_dead_container_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'exited'): self.run_health(running=False)
    def test_bad_fresh_endpoint_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'endpoint'): self.run_health(healthy_at=0,endpoint=False)
    def test_deadline_is_bounded(self):
        with self.assertRaisesRegex(RuntimeError,'deadline'): self.run_health(healthy_at=301)

if __name__ == '__main__': unittest.main()
