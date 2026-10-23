from pathlib import Path
import ast
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from unittest.mock import Mock

HERE = Path(__file__).resolve().parent


class PublicationTests(unittest.TestCase):
    def test_activation_reuses_game_and_nile_images_and_checks_payment_dependencies(self):
        with tempfile.TemporaryDirectory(prefix='royal-admin-activation-') as directory:
            root = Path(directory)
            (root / 'runtime').mkdir()
            (root / 'runtime/payments.js').write_text('import pg from "pg";')
            tree = ast.parse((HERE / 'deploy.py').read_text())
            functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build'], type_ignores=[])
            run = Mock(side_effect=lambda args: 'new-payments' if args[1:3] == ['image', 'inspect'] else 'ok')
            saved = Mock()
            env = {'ROOT': root, 'M': {'activationOnly': True, 'paymentImports': ['pg', 'express']},
                   'OLD': {'containers': {'game': {'image': 'old-game'}, 'payments': {'image': 'old-payments'}, 'nile': {'image': 'old-nile'}}},
                   'SERVICES': {'game': 'game', 'payments': 'payments', 'nile': 'nile'},
                   'TAGS': {'payments': 'royal-payments:latest'}, 'NAME': 'test', 'json': json, 'shutil': shutil,
                   'payload': Mock(), 'guard': Mock(), 'backup': Mock(return_value={}), 'run': run,
                   'subprocess': Mock(), 'save': saved}
            exec(compile(functions, str(HERE / 'deploy.py'), 'exec'), env)
            env['build']()
            self.assertEqual(saved.call_args.args[1]['images'], {'game': 'old-game', 'payments': 'new-payments', 'nile': 'old-nile'})
            self.assertEqual([p.name for p in root.glob('build-*')], ['build-payments'])
            imports_probe = run.call_args_list[-1].args[0]
            self.assertIn('--network=none', imports_probe)
            self.assertIn('await import(name)', imports_probe[-1])

    def test_owner_configuration_preserves_existing_secrets_domains_and_overrides(self):
        with tempfile.TemporaryDirectory(prefix='royal-admin-release-') as directory:
            root = Path(directory)
            live, finance, payload = root / 'live', root / 'finance', root / 'payload'
            for p in [live, finance, payload]:
                p.mkdir()
            original = '# keep comment\nSITE_DOMAIN=casino.example\nPRIVATE_SECRET=opaque-test-value\nCOMPOSE_FILE=compose.yaml:compose.mira.yaml\n'
            (live / '.env').write_text(original)
            (payload / 'compose.finance-admin.yaml').write_text('services: {}\n')
            (payload / 'compose.admin.yaml').write_text('services: {}\n')
            tree = ast.parse((HERE / 'deploy.py').read_text())
            functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ['atomic', 'configure']], type_ignores=[])
            owner = '12345678-1234-4123-8123-123456789abc'
            env = {'Path': Path, 'os': os, 'shutil': shutil, 'ROOT': payload, 'LIVE': live, 'FINANCE': finance,
                   'M': {'ownerId': owner}, 'OLD': {'containers': {'game': {'composeFiles': ['compose.yaml', 'compose.mira.yaml']}}}, 'SERVICES': {'game': 'game'}}
            exec(compile(functions, str(HERE / 'deploy.py'), 'exec'), env)
            files = env['configure']()
            updated = (live / '.env').read_text()
            for line in original.splitlines():
                if not line.startswith('COMPOSE_FILE='):
                    self.assertIn(line + '\n', updated)
            self.assertIn('FINANCE_ADMIN_ACCOUNT_IDS=' + owner + '\n', updated)
            self.assertEqual(files[:2], ['compose.yaml', 'compose.mira.yaml'])
            self.assertFalse((payload / 'production-env-private').exists())
            with self.assertRaises(AssertionError):
                env['atomic'](payload / 'compose.admin.yaml', root / 'outside.yaml')

    def test_runtime_comparison_ignores_only_the_admin_setting_and_order(self):
        spec = importlib.util.spec_from_file_location('admin_snapshot', HERE / 'snapshot.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        row = {'Config': {'Env': ['B=2', 'A=1'], 'User': 'node', 'WorkingDir': '/app', 'Cmd': ['node', 'index.js']},
               'HostConfig': {'Memory': 256}, 'Mounts': [], 'NetworkSettings': {'Networks': {'private': {}}}}
        changed = json.loads(json.dumps(row))
        changed['Config']['Env'] = ['FINANCE_ADMIN_ACCOUNT_IDS=owner', 'A=1', 'B=2']
        self.assertEqual(module.profile(row, True), module.profile(changed, True))
        changed['HostConfig']['Memory'] = 512
        self.assertNotEqual(module.profile(row, True), module.profile(changed, True))


if __name__ == '__main__':
    unittest.main()
