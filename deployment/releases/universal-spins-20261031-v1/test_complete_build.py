"""Check fail-closed candidate finalization without Docker or a production connection."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import copy
import importlib.util
import json
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('complete_build', HERE / 'complete-build.py')
helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)


class CompletionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        root = Path(temp.name); (root / 'runtime-context').mkdir()
        (root / 'runtime-context/Dockerfile').write_text('reviewed recipe')
        (root / 'build-process.json').write_text(json.dumps({'sourceCommit': helper.SOURCE,
            'command': ['python3', str(root / 'deploy.py'), 'build'], 'pid': 2147483647}))
        self.image = 'sha256:' + 'a' * 64
        (root / 'build-run.log').write_text(helper.FAILURE + '\n')
        (root / 'build.log').write_text('Successfully built ' + 'a' * 12 + '\nSuccessfully tagged royal-game:universal-spins-20261031-v1\n')
        self.events = []; self.output = {}; self.program = {'wallet.js': 'kept', 'index.js': 'new'}
        self.parent = {'Config': {'User': 'node'}, 'RootFS': {'Layers': ['parent']}}
        self.child = copy.deepcopy(self.parent); self.child.update({'Id': self.image})
        self.child['Config']['Labels'] = {'org.opencontainers.image.revision': helper.SOURCE}
        self.child['RootFS']['Layers'].append('new')
        def run(args):
            self.events.append(args[1]); return json.dumps([self.parent, self.child] if args[1] == 'image' else self.program)
        self.base = SimpleNamespace(ROOT=root, NAME='universal-spins-20261031-v1', M={'sourceCommit': helper.SOURCE},
            LIVE=root, BACKUP=root, OLD={'preparedImage': 'sha256:parent'}, DELTA={'index': 'hash'}, SERVER_DELTA={'server': 'hash'},
            PROGRAM='reviewed inventory', payload=lambda: self.events.append('payload'), baseline=lambda: self.events.append('baseline'),
            verify_existing_backup=lambda: self.events.append('backup'), image=lambda _: self.image, run=run,
            inventory=lambda p: {'index': 'hash'} if p.name == 'dist-delta' else {'server': 'hash'},
            expected_program=lambda: {'wallet.js': 'kept', 'index.js': 'new'}, write=lambda name, value: self.output.update({name: value}))
        self.deploy = SimpleNamespace(MIN_FREE=5 * 1024**3, read=lambda p: json.loads(p.read_text()),
            dockerfile=lambda _: 'reviewed recipe', sha=lambda _: 'checked hash', database_backup_guard=lambda _: {'checked': True})
        self.disk = patch.object(helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=6 * 1024**3))
        self.disk.start(); self.addCleanup(self.disk.stop)

    def test_success_reuses_candidate_and_rechecks_original_guards(self):
        result = helper.complete(self.base, self.deploy)
        self.assertFalse(result['rebuildPerformed']); self.assertEqual(self.events.count('baseline'), 2)
        self.assertIn('backup', self.events); self.assertNotIn('build', self.events)
        self.assertEqual(self.output['build-result.json']['program'], self.program)

    def test_low_disk_never_writes_success(self):
        with patch.object(helper.shutil, 'disk_usage', return_value=SimpleNamespace(free=5 * 1024**3)):
            with self.assertRaisesRegex(RuntimeError, 'reserve'): helper.complete(self.base, self.deploy)
        self.assertFalse(self.output)

    def test_different_terminal_failure_is_rejected(self):
        (self.base.ROOT / 'build-run.log').write_text('RuntimeError: unrelated failure')
        with self.assertRaisesRegex(RuntimeError, 'disk guard'): helper.complete(self.base, self.deploy)

    def test_running_original_process_is_rejected(self):
        original = Path.exists
        with patch.object(Path, 'exists', lambda p: True if str(p) == '/proc/2147483647' else original(p)):
            with self.assertRaisesRegex(RuntimeError, 'still exists'): helper.complete(self.base, self.deploy)

    def test_wrong_revision_and_parent_layers_are_rejected(self):
        self.child['Config']['Labels']['org.opencontainers.image.revision'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'revision'): helper.complete(self.base, self.deploy)
        self.child['Config']['Labels']['org.opencontainers.image.revision'] = helper.SOURCE
        self.child['RootFS']['Layers'][0] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'Parent image'): helper.complete(self.base, self.deploy)

    def test_protected_bytes_and_context_drift_are_rejected(self):
        self.program['wallet.js'] = 'changed'
        with self.assertRaisesRegex(RuntimeError, 'protected runtime'): helper.complete(self.base, self.deploy)
        (self.base.ROOT / 'runtime-context/Dockerfile').write_text('foreign')
        with self.assertRaisesRegex(RuntimeError, 'recipe'): helper.complete(self.base, self.deploy)

    def test_disk_must_remain_above_floor_after_verification(self):
        with patch.object(helper.shutil, 'disk_usage', side_effect=[SimpleNamespace(free=6 * 1024**3), SimpleNamespace(free=1)]):
            with self.assertRaisesRegex(RuntimeError, 'consumed'): helper.complete(self.base, self.deploy)
        self.assertFalse(self.output)


if __name__ == '__main__': unittest.main()
