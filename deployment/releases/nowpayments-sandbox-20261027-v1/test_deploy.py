import ast
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import sandbox_config as config

CODE = Path(__file__).with_name('deploy.py').read_text()


def functions(names, **values):
    namespace = dict(Path=Path, json=json, **values)
    for node in ast.parse(CODE).body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            exec(compile(ast.Module(body=[node], type_ignores=[]), 'deploy.py', 'exec'), namespace)
    return namespace


class SandboxConfiguration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'release'
        self.live = Path(self.temp.name).resolve() / 'live'
        self.root.mkdir(); self.live.mkdir()
        self.values = {'NOWPAYMENTS_SANDBOX_ENABLED': 'true',
                       'NOWPAYMENTS_SANDBOX_API_KEY': 'fixture-api-key-123456',
                       'NOWPAYMENTS_SANDBOX_IPN_SECRET': 'fixture-ipn-secret-123456',
                       'NOWPAYMENTS_SANDBOX_CURRENCY': 'btc'}
        self.private = self.root / 'private-sandbox.env'
        self.private.write_text(''.join(key + '=' + value + '\n' for key, value in self.values.items()))
        self.private.chmod(0o600)
        (self.root / config.COMPOSE).write_text('services:\n  game:\n    env_file: [./.env.nowpayments-sandbox]\n')
        self.manifest = {'sandboxConfigHash': config.digest(self.private),
                         'sandboxComposeHash': config.digest(self.root / config.COMPOSE),
                         'before': {'configHashes': {'.env': 'prior'}}}

    def test_exact_private_configuration_is_accepted(self):
        self.assertEqual(config.read_private(self.private), self.values)
        config.validate_staged(self.root, self.manifest)

    def test_live_flag_or_unknown_variable_is_rejected(self):
        with self.private.open('a') as output:
            output.write('NOWPAYMENTS_ENABLED=true\n')
        with self.assertRaises(RuntimeError): config.read_private(self.private)

    def test_duplicate_variable_is_rejected(self):
        with self.private.open('a') as output:
            output.write('NOWPAYMENTS_SANDBOX_ENABLED=true\n')
        with self.assertRaises(RuntimeError): config.read_private(self.private)

    def test_environment_interpolation_characters_are_rejected(self):
        self.private.write_text(self.private.read_text().replace('fixture-api-key-123456', '${OTHER_SECRET}'))
        with self.assertRaises(RuntimeError): config.read_private(self.private)

    def test_public_permissions_and_symlink_are_rejected(self):
        self.private.chmod(0o644)
        with self.assertRaises(RuntimeError): config.read_private(self.private)
        self.private.rename(self.root / 'original')
        self.private.symlink_to(self.root / 'original')
        with self.assertRaises(RuntimeError): config.read_private(self.private)

    def test_changed_secret_hash_is_rejected(self):
        self.manifest['sandboxConfigHash'] = '0' * 64
        with self.assertRaises(RuntimeError): config.validate_staged(self.root, self.manifest)

    def test_existing_configuration_is_never_overwritten(self):
        self.manifest['before']['configHashes'][config.PRIVATE] = 'existing'
        with self.assertRaises(RuntimeError): config.validate_staged(self.root, self.manifest)

    def test_install_and_recovery_preserve_unrelated_environment(self):
        (self.live / '.env').write_text('unchanged environment')
        config.install(self.root, self.live, self.manifest)
        self.assertEqual(config.read_private(self.live / config.PRIVATE), self.values)
        with self.assertRaises(RuntimeError): config.install(self.root, self.live, self.manifest)
        config.remove_owned(self.live, self.manifest)
        self.assertFalse((self.live / config.PRIVATE).exists())
        self.assertEqual((self.live / '.env').read_text(), 'unchanged environment')

    def test_recovery_refuses_later_configuration(self):
        config.install(self.root, self.live, self.manifest)
        (self.live / config.COMPOSE).write_text('later configuration')
        with self.assertRaises(RuntimeError): config.remove_owned(self.live, self.manifest)
        self.assertTrue((self.live / config.PRIVATE).exists())

    def state(self):
        runtime = {'User': 'node', 'WorkingDir': '/app', 'Entrypoint': ['docker-entrypoint.sh'],
                   'Cmd': ['node', 'dist-server/index.js'], 'Env': ['PUBLIC_ORIGIN=https://example.test', 'NOWPAYMENTS_ENABLED=false']}
        old_hash = config.runtime_state(runtime, self.live)['runtimeWithoutSandboxHash']
        old = {'configHashes': {'.env': 'prior'}, 'container': {'runtimeHash': old_hash, 'composeFiles': '/opt/royal/compose.yaml'}}
        config.install(self.root, self.live, self.manifest)
        runtime['Env'] += [key + '=' + value for key, value in self.values.items()]
        current = {'configHashes': {**old['configHashes'], config.PRIVATE: self.manifest['sandboxConfigHash'],
                                    config.COMPOSE: self.manifest['sandboxComposeHash']},
                   'container': {**config.runtime_state(runtime, self.live),
                                 'runtimeHash': 'new', 'composeFiles': '/opt/royal/compose.yaml,/opt/royal/' + config.COMPOSE}}
        return runtime, old, current

    def test_only_the_exact_sandbox_addition_passes_runtime_guard(self):
        _, old, current = self.state()
        config.check_settings(current, old, self.manifest, sandbox=True)
        config.check_settings(current, old, self.manifest, recovery=True)

    def test_live_flag_change_is_detected_after_sandbox_is_removed_from_comparison(self):
        runtime, old, current = self.state()
        runtime['Env'][1] = 'NOWPAYMENTS_ENABLED=true'
        current['container'].update(config.runtime_state(runtime, self.live))
        with self.assertRaisesRegex(RuntimeError, 'Unrelated runtime'): config.check_settings(current, old, self.manifest, sandbox=True)

    def test_unknown_sandbox_variable_is_detected(self):
        runtime, old, current = self.state()
        runtime['Env'].append('NOWPAYMENTS_SANDBOX_API_KEY_FILE=/other')
        current['container'].update(config.runtime_state(runtime, self.live))
        with self.assertRaises(RuntimeError): config.check_settings(current, old, self.manifest, sandbox=True)

    def test_changed_private_runtime_key_is_detected(self):
        runtime, old, current = self.state()
        runtime['Env'][-2] = 'NOWPAYMENTS_SANDBOX_IPN_SECRET=other-private-secret'
        current['container'].update(config.runtime_state(runtime, self.live))
        with self.assertRaises(RuntimeError): config.check_settings(current, old, self.manifest, sandbox=True)

    def test_unrelated_compose_or_configuration_change_is_detected(self):
        _, old, current = self.state()
        for key in ['.env', 'unrelated.yaml']:
            value = copy.deepcopy(current); value['configHashes'][key] = 'changed'
            with self.assertRaises(RuntimeError): config.check_settings(value, old, self.manifest, recovery=True)
        current['container']['composeFiles'] += ',/other.yaml'
        with self.assertRaises(RuntimeError): config.check_settings(current, old, self.manifest, sandbox=True)


class PublicationGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'build-result.json').write_text(json.dumps({'program': {}, 'image': 'candidate'}))

    def fixture(self, gate):
        calls = []
        namespace = functions(['require', 'publish'], ROOT=self.root, LIVE=self.root, NAME='fixture',
            M={'sourceCommit': 'revision'}, CHANGES={'code': 'a'}, DELETED=[], DELTA={},
            payload=lambda: None, baseline=lambda: None, expected_program=lambda: {}, image=lambda ref: 'candidate',
            publication_backup=lambda value: None, publication_capacity=lambda: None, quiet_gate=gate,
            rollback=lambda: calls.append('rollback'), atomic=lambda *args: calls.append('source'),
            reconcile_game=lambda value: calls.append('observe'), write=lambda name, value: calls.append((name, value)),
            signal=types.SimpleNamespace(SIGTERM=15, SIGHUP=1, SIGINT=2, SIG_IGN=0, signal=lambda *args: None))
        return namespace, calls

    def test_busy_financial_gate_never_mutates_or_rolls_back(self):
        n, calls = self.fixture(lambda: (_ for _ in ()).throw(RuntimeError('busy')))
        with self.assertRaisesRegex(RuntimeError, 'busy'): n['publish']()
        self.assertEqual(calls, [])

    def test_disk_loss_before_gate_never_mutates(self):
        n, calls = self.fixture(lambda: calls.append('gate'))
        n['publication_capacity'] = lambda: (_ for _ in ()).throw(RuntimeError('reserve'))
        with self.assertRaises(RuntimeError): n['publish']()
        self.assertEqual(calls, [])

    def test_unknown_docker_outcome_never_repeats_compose(self):
        gate = types.SimpleNamespace(confirm=lambda: None, check=lambda: None,
            run=lambda *a, **k: (_ for _ in ()).throw(RuntimeError('Docker interrupted')),
            release=lambda: None, close=lambda: None)
        n, calls = self.fixture(lambda: gate)
        with patch.object(config, 'install', lambda *args: None):
            with self.assertRaisesRegex(RuntimeError, 'Docker interrupted'): n['publish']()
        self.assertNotIn('rollback', calls); self.assertIn('observe', calls)
        receipts = {row[0]: row[1] for row in calls if isinstance(row, tuple)}
        self.assertTrue(receipts['recovery-required.json']['automaticSecondComposeRefused'])

    def test_source_backup_covers_replaced_and_deleted_paths(self):
        n = functions(['source_backup_entries'], OLD={'source': {'changed': 'a', 'removed': 'b', 'retained': 'c'}},
                      CHANGES={'changed': 'd', 'new': 'e'}, DELETED=['removed'])
        self.assertEqual(n['source_backup_entries'](), {'changed': 'a', 'removed': 'b'})

    def test_later_runtime_blocks_publication(self):
        old = {'container': {'health': 'healthy'}, 'source': {'source': 'a'}, 'program': {'file': 'a'},
               'preparedProgram': {'file': 'a'}, 'preparedImage': 'old'}
        state = copy.deepcopy(old); state['program']['file'] = 'newer'
        n = functions(['require', 'baseline', 'sources'], OLD=old, BASE=old['source'],
                      snapshot=lambda: state, settings=lambda value: None)
        with self.assertRaises(RuntimeError): n['baseline']()


if __name__ == '__main__': unittest.main()
