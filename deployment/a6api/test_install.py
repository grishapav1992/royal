import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class CredentialLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.key = Path(self.directory.name) / 'key'

    def test_initial_transfer_then_update_without_local_key_preserves_credential(self):
        installer.install_credential(self.key, 'test-server-only-credential')
        before = self.key.stat()
        installer.install_credential(self.key, None)
        self.assertEqual(self.key.read_text(), 'test-server-only-credential\n')
        self.assertEqual(self.key.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(self.key.stat().st_mode & 0o777, 0o600)

    def test_missing_server_key_requires_initial_transfer(self):
        with self.assertRaises(RuntimeError):
            installer.install_credential(self.key, None)
        self.assertFalse(self.key.exists())

    def test_update_never_rotates_existing_key_implicitly(self):
        installer.install_credential(self.key, 'test-original')
        with self.assertRaises(RuntimeError):
            installer.install_credential(self.key, 'test-different')
        self.assertEqual(self.key.read_text(), 'test-original\n')

    def test_existing_unsafe_permissions_or_symlink_fail_closed(self):
        installer.install_credential(self.key, 'test-original')
        self.key.chmod(0o644)
        with self.assertRaises(RuntimeError):
            installer.install_credential(self.key, None)
        self.key.unlink()
        self.key.symlink_to('/does/not/exist')
        with self.assertRaises(OSError):
            installer.install_credential(self.key, None)


if __name__ == '__main__':
    unittest.main()
