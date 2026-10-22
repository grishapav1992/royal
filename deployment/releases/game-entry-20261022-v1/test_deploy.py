"""Exercise recovery against partial publication and concurrent changes without production access."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sha = lambda value: hashlib.sha256(value).hexdigest()


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name).resolve()
        for filename in ['deploy.py', 'publisher.py']:
            shutil.copy2(HERE / filename, root / filename)
        manifest = {'before': {'source': {}, 'moduleFiles': {}}, 'changed': {}, 'delta': {}, 'modules': {}}
        (root / 'install-manifest.json').write_text(json.dumps(manifest))
        spec = importlib.util.spec_from_file_location('deployment_under_test', root / 'deploy.py')
        self.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.helper)
        helper = self.helper
        helper.PUBLIC = root / 'public'
        helper.PUBLIC.mkdir()
        helper.BACKUP = root / 'backup'
        self.games = ['studio-cosmic-escape', 'studio-caramel-carnival']
        self.original = {'format': 1, 'gameId': self.games[0], 'manifest': '/old/manifest.json', 'sha256': '1' * 64}
        original_bytes = (json.dumps(self.original, indent=2) + '\n').encode()
        helper.MODULES = {game: {'version': '1.0.0-123456789abc', 'expectedSha256': sha(original_bytes) if index == 0 else 'none',
                               'files': {'manifest.json': '2' * 64, 'media/image.webp': sha(b'new image')}}
                          for index, game in enumerate(self.games)}
        self.old_asset = str(helper.PUBLIC / self.games[0] / 'versions/1.0.0-aaaaaaaaaaaa/media/old.webp')
        self.other_pointer = str(helper.PUBLIC / 'studio-dracona/active.json')
        helper.OLD['moduleFiles'] = {str(helper.PUBLIC / self.games[0] / 'active.json'): sha(original_bytes),
                                     self.old_asset: sha(b'old image'), self.other_pointer: sha(b'other pointer')}
        saved = helper.BACKUP / 'pointers' / self.games[0] / 'active.json'
        saved.parent.mkdir(parents=True)
        saved.write_bytes(original_bytes)
        self.full = {'moduleFiles': helper.module_files()}

    def write_new_pointers(self):
        helper = self.helper
        publisher = helper.publisher()
        for game, spec in helper.MODULES.items():
            target = helper.PUBLIC / game / 'active.json'
            target.parent.mkdir(parents=True, exist_ok=True)
            value = {'format': 1, 'gameId': game,
                     'manifest': '/game-modules/' + game + '/versions/' + spec['version'] + '/manifest.json',
                     'sha256': spec['files']['manifest.json']}
            publisher.atomic_json(target, value)
            self.assertEqual(publisher.active_sha(target), helper.pointer_hash(game))

    def test_partial_batch_can_recover(self):
        helper = self.helper
        partial = dict(helper.OLD['moduleFiles'])
        first_prefix = str(helper.PUBLIC / self.games[0]) + '/'
        partial.update({name: digest for name, digest in self.full['moduleFiles'].items() if name.startswith(first_prefix)})
        helper.rollback_module_guard({'moduleFiles': partial})

    def test_partial_new_version_inventory_can_recover(self):
        helper = self.helper
        partial = dict(helper.OLD['moduleFiles'])
        spec = helper.MODULES[self.games[1]]
        prefix = str(helper.PUBLIC / self.games[1] / 'versions' / spec['version']) + '/'
        partial[prefix + 'manifest.json'] = spec['files']['manifest.json']
        helper.rollback_module_guard({'moduleFiles': partial})

    def test_incomplete_known_pending_copy_can_recover(self):
        helper = self.helper
        partial = dict(helper.OLD['moduleFiles'])
        path = str(helper.PUBLIC / self.games[1] / 'versions' / ('.pending-' + 'a' * 32) / 'media/image.webp')
        partial[path] = sha(b'incomplete bytes')
        helper.rollback_module_guard({'moduleFiles': partial})

    def test_retained_old_version_tampering_blocks_recovery(self):
        state = copy.deepcopy(self.full)
        state['moduleFiles'][self.old_asset] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'retained module changed'):
            self.helper.rollback_module_guard(state)

    def test_other_game_pointer_change_blocks_recovery(self):
        state = copy.deepcopy(self.full)
        state['moduleFiles'][self.other_pointer] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'retained module changed'):
            self.helper.rollback_module_guard(state)

    def test_later_target_pointer_blocks_recovery(self):
        state = copy.deepcopy(self.full)
        state['moduleFiles'][str(self.helper.PUBLIC / self.games[0] / 'active.json')] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'later module pointer'):
            self.helper.rollback_module_guard(state)

    def test_unrelated_new_version_blocks_recovery(self):
        state = copy.deepcopy(self.full)
        state['moduleFiles'][str(self.helper.PUBLIC / 'studio-dracona/versions/1.0.0-bbbbbbbbbbbb/entry.js')] = 'f' * 64
        with self.assertRaisesRegex(RuntimeError, 'unrelated module was added'):
            self.helper.rollback_module_guard(state)

    def test_changed_new_version_asset_blocks_before_any_pointer_changes(self):
        helper = self.helper
        self.write_new_pointers()
        before = {game: (helper.PUBLIC / game / 'active.json').read_bytes() for game in self.games}
        state = copy.deepcopy(self.full)
        spec = helper.MODULES[self.games[1]]
        path = str(helper.PUBLIC / self.games[1] / 'versions' / spec['version'] / 'media/image.webp')
        state['moduleFiles'][path] = sha(b'tampered new image')
        with self.assertRaisesRegex(RuntimeError, 'new module resource changed'):
            helper.restore_module_pointers(state)
        self.assertEqual({game: (helper.PUBLIC / game / 'active.json').read_bytes() for game in self.games}, before)

    def test_unexpected_new_version_file_blocks_before_any_pointer_changes(self):
        helper = self.helper
        self.write_new_pointers()
        before = {game: (helper.PUBLIC / game / 'active.json').read_bytes() for game in self.games}
        state = copy.deepcopy(self.full)
        spec = helper.MODULES[self.games[1]]
        path = str(helper.PUBLIC / self.games[1] / 'versions' / spec['version'] / 'media/unexpected.webp')
        state['moduleFiles'][path] = sha(b'unexpected file')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected new module file'):
            helper.restore_module_pointers(state)
        self.assertEqual({game: (helper.PUBLIC / game / 'active.json').read_bytes() for game in self.games}, before)

    def test_unknown_pending_file_blocks_recovery(self):
        helper = self.helper
        state = copy.deepcopy(self.full)
        path = str(helper.PUBLIC / self.games[1] / 'versions' / ('.pending-' + 'a' * 32) / 'media/unexpected.webp')
        state['moduleFiles'][path] = sha(b'unexpected pending file')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected pending module file'):
            helper.rollback_module_guard(state)

    def test_restore_previous_override_and_baseline_fallback_retains_versions(self):
        helper = self.helper
        self.write_new_pointers()
        retained = helper.PUBLIC / self.games[1] / 'versions/1.0.0-123456789abc/media/image.webp'
        retained.parent.mkdir(parents=True)
        retained.write_bytes(b'new image')
        expected = helper.restore_module_pointers(self.full)
        self.assertEqual(json.loads((helper.PUBLIC / self.games[0] / 'active.json').read_text()), self.original)
        self.assertFalse((helper.PUBLIC / self.games[1] / 'active.json').exists())
        self.assertEqual(retained.read_bytes(), b'new image')
        self.assertIn(str(retained), expected)
        self.assertEqual(expected[self.old_asset], helper.OLD['moduleFiles'][self.old_asset])

    def test_stale_filesystem_snapshot_does_not_change_any_pointer(self):
        helper = self.helper
        self.write_new_pointers()
        later = helper.PUBLIC / self.games[1] / 'active.json'
        later.write_text('{"later":true}\n')
        prior_first = (helper.PUBLIC / self.games[0] / 'active.json').read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'pointer changed before recovery'):
            helper.restore_module_pointers(self.full)
        self.assertEqual((helper.PUBLIC / self.games[0] / 'active.json').read_bytes(), prior_first)
        self.assertEqual(later.read_text(), '{"later":true}\n')


if __name__ == '__main__':
    unittest.main()
