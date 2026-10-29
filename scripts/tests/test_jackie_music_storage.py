import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

path = Path(__file__).resolve().parents[2] / 'deployment/releases/jackie-music-20261030-v1/media_storage.py'
spec = importlib.util.spec_from_file_location('jackie_music_storage', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MusicStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base, self.target = [Path(self.temporary.name) / name for name in ['base', 'target']]
        for directory in [self.base, self.target]:
            (directory / 'media').mkdir(parents=True)
            (directory / 'media/art.webp').write_bytes(b'identical immutable artwork')
            (directory / 'entry.js').write_bytes(b'entry')
            digest = hashlib.sha256((directory / 'media/art.webp').read_bytes()).hexdigest()
            (directory / 'manifest.json').write_text(json.dumps({'gameId': 'original-jackie-chan', 'files': {'media/art.webp': digest, 'entry.js': hashlib.sha256(b'entry').hexdigest()}}))

    def test_preserves_bytes_and_every_version_and_is_repeatable(self):
        result = module.deduplicate(self.base, self.target)
        self.assertEqual(len(result['linked']), 1)
        self.assertTrue((self.target / 'media/art.webp').samefile(self.base / 'media/art.webp'))
        self.assertFalse((self.target / 'entry.js').samefile(self.base / 'entry.js'))
        self.assertEqual(module.deduplicate(self.base, self.target)['linked'], [])

    def test_tampering_is_rejected_before_linking(self):
        (self.target / 'media/art.webp').write_bytes(b'altered')
        with self.assertRaisesRegex(RuntimeError, 'bytes differ'):
            module.deduplicate(self.base, self.target)
        self.assertEqual((self.target / 'media/art.webp').read_bytes(), b'altered')

    def test_unrelated_games_and_path_escape_are_rejected(self):
        manifest = self.target / 'manifest.json'
        value = json.loads(manifest.read_text()); value['gameId'] = 'another-game'; manifest.write_text(json.dumps(value))
        with self.assertRaisesRegex(RuntimeError, 'Different games'):
            module.deduplicate(self.base, self.target)
        with self.assertRaisesRegex(RuntimeError, 'Unsafe'):
            module.plain(self.target, 'media/../../outside')


if __name__ == '__main__':
    unittest.main()
