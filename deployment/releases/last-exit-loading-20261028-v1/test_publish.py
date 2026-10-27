import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('last_exit_publication', Path(__file__).with_name('publish.py'))
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)

class PersistentServiceGuardTests(unittest.TestCase):
    def snapshot(self, rows):
        with patch.object(publication, 'command', side_effect=['game\npayment\nreader', rows]):
            return publication.persistent_services()

    def test_scheduled_reader_replacement_preserves_the_same_persistent_baseline(self):
        before = self.snapshot('game /royal-game-1 unless-stopped\npayment /royal-payments-1 always\nold /royal-nile-account-views-once no')
        after = self.snapshot('new /royal-nile-reconcile-once no\npayment /royal-payments-1 always\ngame /royal-game-1 unless-stopped')
        self.assertEqual(before, after)
        self.assertEqual(set(before), {'royal-game-1', 'royal-payments-1'})

    def test_persistent_replacement_or_removal_still_changes_the_baseline(self):
        before = self.snapshot('game /royal-game-1 unless-stopped\npayment /royal-payments-1 on-failure')
        replaced = self.snapshot('game /royal-game-1 unless-stopped\nnew /royal-payments-1 on-failure')
        removed = self.snapshot('game /royal-game-1 unless-stopped')
        self.assertNotEqual(before, replaced)
        self.assertNotEqual(before, removed)

if __name__ == '__main__':
    unittest.main()
