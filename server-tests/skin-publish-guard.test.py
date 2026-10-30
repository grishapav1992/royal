"""The publisher must reject real drift without treating the clock as drift."""
import copy
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
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


class RetryGuardTests(unittest.TestCase):
    def test_saved_backup_is_reused_only_when_its_exact_contents_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = b'previous source'
            with tarfile.open(root / 'source.tgz', 'w:gz') as archive:
                row = tarfile.TarInfo('src/game/generatedSkinArt.ts')
                row.size = len(source)
                archive.addfile(row, io.BytesIO(source))
            (root / 'index.html').write_bytes(b'previous index')
            expected = {'src/game/generatedSkinArt.ts': hashlib.sha256(source).hexdigest()}
            index_hash = hashlib.sha256(b'previous index').hexdigest()
            publisher.check_backup(root, expected, index_hash)
            (root / 'index.html').write_bytes(b'different index')
            with self.assertRaisesRegex(RuntimeError, 'Index backup differs'):
                publisher.check_backup(root, expected, index_hash)
            (root / 'index.html').write_bytes(b'previous index')
            with self.assertRaisesRegex(RuntimeError, 'Source backup differs'):
                publisher.check_backup(root, {next(iter(expected)): 'different source'}, index_hash)

    def test_retry_rejects_changed_or_extra_build_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'dist').mkdir()
            (root / 'dist/index.html').write_bytes(b'new index')
            dockerfile = 'FROM reviewed-image\n'
            (root / 'Dockerfile').write_bytes(dockerfile.encode())
            delta = {'index.html': hashlib.sha256(b'new index').hexdigest()}
            publisher.check_context(root, delta, dockerfile)
            (root / 'dist/unreviewed.js').write_bytes(b'extra')
            with self.assertRaisesRegex(RuntimeError, 'Build context differs'):
                publisher.check_context(root, delta, dockerfile)


if __name__ == '__main__':
    unittest.main()
