import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).with_name('cleanup-release-history.py'))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class HistoryScopeTest(unittest.TestCase):
    def test_image_references_use_the_existing_stable_container_inventory(self):
        helper = Mock()
        helper.container_rows.return_value = [{'image': 'active'}, {'image': 'another'}, {'image': 'active'}]
        with patch.object(cleanup, 'native_retention', return_value=helper):
            self.assertEqual(cleanup.referenced_images(), {'active', 'another'})
        helper.container_rows.assert_called_once_with()

    def test_new_unreviewed_release_is_preserved_during_exact_cleanup(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            old = root / 'old'; old.mkdir(); (old / 'source').write_text('old')
            os.utime(old, (time.time() - 3600,) * 2)
            rows = cleanup.deletion_candidates([], (root,))
            new = root / 'another-task'; new.mkdir(); (new / 'source').write_text('new work')
            cleanup.validate_selection(rows, [], (root,))
            cleanup.remove_entry(rows[0], [], (root,))
            self.assertEqual((new / 'source').read_text(), 'new work')

    def test_service_guard_ignores_mount_order_but_checks_mount_content(self):
        mounts = [{'Source': '/keep-a', 'Destination': '/a', 'RW': False},
                  {'Source': '/keep-b', 'Destination': '/b', 'RW': True}]
        container = {'Id': 'same', 'Image': 'same-image', 'State': {'StartedAt': 'same-time'}, 'Mounts': mounts}
        first = cleanup.service_identity(container)
        container['Mounts'] = list(reversed(mounts))
        self.assertEqual(first, cleanup.service_identity(container))
        container['Mounts'] = [{**mounts[0], 'Source': '/changed'}, mounts[1]]
        self.assertNotEqual(first, cleanup.service_identity(container))

    def test_keeps_current_and_only_deletes_reviewed_entries(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            current, old = root / 'current', root / 'old'
            current.mkdir(); old.mkdir()
            (current / 'source').write_text('keep')
            (old / 'source').write_text('retire')
            os.utime(old, (time.time() - 3600,) * 2)
            rows = cleanup.deletion_candidates([current], (root,))
            self.assertEqual([row['path'] for row in rows], [str(old)])
            cleanup.remove_entry(rows[0], [current], (root,))
            self.assertEqual((current / 'source').read_text(), 'keep')
            self.assertFalse(old.exists())

    def test_rejects_changed_and_out_of_scope_entries(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            old = root / 'old'
            old.mkdir(); (old / 'source').write_text('original')
            os.utime(old, (time.time() - 3600,) * 2)
            row = cleanup.deletion_candidates([], (root,))[0]
            (old / 'source').write_text('another task changed this')
            with self.assertRaisesRegex(RuntimeError, 'changed after review'):
                cleanup.remove_entry(row, [], (root,))
            with self.assertRaisesRegex(RuntimeError, 'escaped approved scope'):
                cleanup.remove_entry(row, [old], (root,))
            with self.assertRaisesRegex(RuntimeError, 'escaped approved scope'):
                cleanup.remove_entry(row, [], (root / 'other',))
            self.assertTrue(old.exists())

    def test_never_follows_symlinks_and_preserves_locks(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            history, live = root / 'history', root / 'live'
            history.mkdir(); live.mkdir()
            (live / 'data').write_text('production data')
            link = history / 'old'
            link.symlink_to(live, target_is_directory=True)
            os.utime(link, (time.time() - 3600,) * 2, follow_symlinks=False)
            (history / 'deployment.lock').touch()
            rows = cleanup.deletion_candidates([], (history,))
            self.assertEqual(len(rows), 1)
            cleanup.remove_entry(rows[0], [], (history,))
            self.assertTrue((history / 'deployment.lock').exists())
            self.assertEqual((live / 'data').read_text(), 'production data')

    def test_refuses_recent_history_and_symlink_roots(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            history = root / 'history'
            history.mkdir(); (history / 'active-build').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'may be in use'):
                cleanup.deletion_candidates([], (history,))
            link = root / 'link'; link.symlink_to(history, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, 'Unsafe history root'):
                cleanup.deletion_candidates([], (link,))


if __name__ == '__main__':
    unittest.main()
