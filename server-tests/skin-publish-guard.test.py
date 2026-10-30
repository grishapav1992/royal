"""The publisher must reject real drift without treating the clock as drift."""
import copy
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / 'deployment/releases/skin-walk-alignment-20261030-v1/publish.py'
spec = importlib.util.spec_from_file_location('skin_publish', path)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class SnapshotGuardTests(unittest.TestCase):
    def setUp(self):
        self.before = {
            'at': 1,
            'freeBytes': 6_000_000_000,
            'program': {'dist/index.html': 'original'},
            'source': {'src/game/RoomScene.ts': {'sha256': 'original'}},
            'modules': {'module.json': 'original'},
            'configuration': {'compose.yml': 'original'},
            'preparedImage': 'original',
            'containers': {'royal-game-1': {'id': 'original', 'health': 'healthy'}},
        }

    def test_elapsed_time_and_space_do_not_invalidate_unchanged_release(self):
        after = copy.deepcopy(self.before)
        after.update(at=100, freeBytes=5_900_000_000)
        after['containers']['royal-game-1']['health'] = 'starting'
        self.assertEqual(publisher.stable(self.before), publisher.stable(after))
        self.assertEqual(self.before['containers']['royal-game-1']['health'], 'healthy')

    def test_real_production_changes_always_invalidate_release(self):
        changes = [
            ('program', 'dist/index.html'),
            ('source', 'src/game/RoomScene.ts'),
            ('modules', 'module.json'),
            ('configuration', 'compose.yml'),
        ]
        for section, name in changes:
            with self.subTest(section=section):
                after = copy.deepcopy(self.before)
                after[section][name] = 'changed'
                self.assertNotEqual(publisher.stable(self.before), publisher.stable(after))
        after = copy.deepcopy(self.before)
        after['preparedImage'] = 'changed'
        self.assertNotEqual(publisher.stable(self.before), publisher.stable(after))
        after = copy.deepcopy(self.before)
        after['containers']['royal-game-1']['id'] = 'changed'
        self.assertNotEqual(publisher.stable(self.before), publisher.stable(after))


if __name__ == '__main__':
    unittest.main()
