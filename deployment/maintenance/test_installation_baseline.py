import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from test_install_retention import installer

class ExactInstallationBaseline(unittest.TestCase):
    def test_missing_or_changed_installed_bytes_stop_before_any_mutation(self):
        for kind in ['missing receipt','changed bytes']:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as base:
                root=Path(base).resolve();source=root/'source';source.mkdir()
                current=root/'bin/cleanup-release-history.py';current.parent.mkdir();current.write_text('current')
                receipt={} if kind=='missing receipt' else {'expectedBefore':{'cleanup-release-history.py':'0'*64}}
                with patch.object(installer,'ROOT',root),patch.object(installer,'FILES',{'cleanup-release-history.py'}),patch.object(installer.subprocess,'check_output',return_value='inactive'),patch.object(installer.subprocess,'run') as mutation:
                    with self.assertRaisesRegex(RuntimeError,'baseline required|Installed maintenance changed'):installer.install(source,receipt)
                mutation.assert_not_called();self.assertEqual(current.read_text(),'current');self.assertFalse((root/'original').exists())

if __name__=='__main__':unittest.main()
