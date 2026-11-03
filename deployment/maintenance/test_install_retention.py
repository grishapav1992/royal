import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('install_retention', Path(__file__).with_name('install-retention.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallRetentionTest(unittest.TestCase):
    def receipt(self, root):
        source = root / 'source'; source.mkdir()
        hashes = {}
        for name in sorted(installer.FILES | {'install-retention.py'}):
            path = source / name; path.write_text('verified:' + name)
            hashes[name] = installer.sha(path)
        receipt = root / 'receipt.json'
        receipt.write_text(json.dumps({'sourceCommit':'a'*40, 'githubVerified':True, 'files':hashes}))
        return source, receipt

    def run_invalid(self, root, source, receipt, error):
        with patch.object(installer, 'ROOT', root), patch.object(installer, '__file__', str(source/'install-retention.py')), patch.object(installer.os,'geteuid',return_value=0), patch('sys.argv',['install-retention.py','--receipt',str(receipt)]), patch.object(installer.subprocess,'run') as changes, patch.object(installer.subprocess,'check_output') as state:
            with self.assertRaisesRegex(RuntimeError, error): installer.main()
        changes.assert_not_called(); state.assert_not_called()

    def test_previous_receipt_without_collector_cannot_install_new_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); source, receipt = self.receipt(root)
            value = json.loads(receipt.read_text()); value['files'].pop('production-graph-receipt.py')
            receipt.write_text(json.dumps(value))
            self.run_invalid(root, source, receipt, 'Incomplete GitHub installation receipt')

    def test_collector_bytes_must_match_github_receipt_before_any_installation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); source, receipt = self.receipt(root)
            (source/'production-graph-receipt.py').write_text('unreviewed collector')
            self.run_invalid(root, source, receipt, 'Unreviewed maintenance file: production-graph-receipt.py')


if __name__ == '__main__': unittest.main()
