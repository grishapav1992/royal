import importlib.util, json, sys, tempfile, types, unittest
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
        for name in ['src/game/RoomScene.ts', 'src/shared/arcadeCatalog.ts']:
            changes, server, graph, before = self.fixture()
            if name in changes: changes.pop(name)
            else: changes[name] = 'changed'
            with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)
    def test_new_unbound_source_is_rejected(self):
        changes, server, graph, before = self.fixture(); graph['inputs'].pop('src/game/RoomScene.ts')
        with self.assertRaises(RuntimeError): deploy.validate_scope(changes, server, graph, before)

    def test_reserved_ready_marker_is_bound_to_the_exact_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'install-manifest.json').write_text('{}')
            (root / 'reservation-ready.json').write_text(json.dumps({'reservation': 'current', 'installManifestSha256': deploy.sha(root / 'install-manifest.json')}))
            deploy.wait_for_ready(root, 'current', 1)

    def test_stale_reservation_or_changed_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'install-manifest.json').write_text('{}')
            for nonce, digest in [('previous', deploy.sha(root / 'install-manifest.json')), ('current', 'foreign')]:
                (root / 'reservation-ready.json').write_text(json.dumps({'reservation': nonce, 'installManifestSha256': digest}))
                with self.assertRaises(RuntimeError): deploy.wait_for_ready(root, 'current', 1)

    def test_reserved_preparation_expires_without_ready_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(TimeoutError): deploy.wait_for_ready(Path(directory), 'current', 0)

class StartupHealthTest(unittest.TestCase):
    def fixture(self, ready_after=0, endpoint=True, running=True):
        clock, calls = [0], []
        def run(args):
            calls.append(args)
            if args[:2] == ['docker', 'inspect']:
                return json.dumps([{'State': {'Running': running, 'Health': {'Status': 'healthy' if clock[0] >= ready_after else 'starting'}}}])
            self.assertEqual(args[:3], ['docker', 'exec', 'royal-game-1'])
            return json.dumps({'ok': endpoint})
        return types.SimpleNamespace(run=run), clock, calls

    def test_slow_start_waits_for_docker_and_a_fresh_health_endpoint(self):
        base, clock, calls = self.fixture(ready_after=120)
        deploy.wait_for_healthy(base, now=lambda: clock[0], pause=lambda seconds: clock.__setitem__(0, clock[0] + seconds))
        self.assertEqual(clock[0], 120)
        self.assertEqual(calls[-1][:3], ['docker', 'exec', 'royal-game-1'])

    def test_docker_healthy_without_ready_endpoint_is_rejected(self):
        base, _, _ = self.fixture(endpoint=False)
        with self.assertRaises(RuntimeError): deploy.wait_for_healthy(base)

    def test_startup_wait_is_bounded(self):
        base, clock, calls = self.fixture(ready_after=999)
        with self.assertRaises(RuntimeError):
            deploy.wait_for_healthy(base, timeout=3, now=lambda: clock[0], pause=lambda seconds: clock.__setitem__(0, clock[0] + seconds))
        self.assertEqual(clock[0], 3)
        self.assertTrue(all(args[:2] == ['docker', 'inspect'] for args in calls))

    def test_exited_game_is_rejected(self):
        base, _, _ = self.fixture(running=False)
        with self.assertRaises(RuntimeError): deploy.wait_for_healthy(base)

if __name__ == '__main__': unittest.main()


