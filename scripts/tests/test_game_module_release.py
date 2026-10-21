"""Publication safeguards for independent games, without application or database access."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'game-module-release.py'
GAMES = {
    'studio-afterglow': {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 3},
    'studio-signal-fox': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
    'github-crash': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
    'royal-mines': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
    'hockey': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
    'casinoapipro': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
    'orbit': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
    'studio-orbit': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
    'original-cr-vs-leo': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


class ModuleReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='royal-modules-')
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / 'public'
        self.state = self.base / 'private'
        self.root.mkdir()
        self.state.mkdir()
        (self.state / 'host.json').write_text(json.dumps({'games': GAMES}))
        self.unrelated = self.root / 'host-preserved.txt'
        self.unrelated.write_text('shared application is unchanged')

    def tearDown(self):
        self.temporary.cleanup()

    def package(self, game, release=1, suffix=''):
        source = self.base / f'{game}-{release}{suffix}'
        source.mkdir()
        files = {}
        for kind, extension, contents in [('entry', 'js', f'export const fixture = {release!r};/*{suffix}*/'), ('style', 'css', f':root {{ --fixture: {release}; }}')]:
            value = contents.encode()
            name = f'{kind}-{digest(value)[:16]}.{extension}'
            (source / name).write_bytes(value)
            files[name] = digest(value)
        version = f'1.0.{release}-{digest(f"{game}:{release}".encode())[:12]}'
        metadata = {
            'format': 1, 'gameId': game, 'version': version, **GAMES[game],
            'sourceSha256': digest(f'{game}:{release}'.encode()),
            'entry': next(name for name in files if name.endswith('.js')),
            'styles': [next(name for name in files if name.endswith('.css'))],
            'files': files,
        }
        (source / 'manifest.json').write_text(json.dumps(metadata))
        return source, metadata

    def command(self, operation, *, package=None, game=None, expected=None, version=None, success=True):
        command = [sys.executable, str(SCRIPT), operation, '--root', str(self.root), '--state', str(self.state), '--app-lock', str(self.base / 'application.lock')]
        for option, value in [('package', package), ('game', game), ('expected-sha', expected), ('version', version)]:
            if value is not None:
                command.extend(['--' + option, str(value)])
        result = subprocess.run(command, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        return result.stderr

    def pointer(self, game):
        return self.root / game / 'active.json'

    def test_two_games_install_and_rollback_independently(self):
        girl, _ = self.package('studio-afterglow')
        fox, first = self.package('studio-signal-fox')
        girl_result = self.command('install', package=girl, expected='none')
        girl_bytes = self.pointer('studio-afterglow').read_bytes()
        first_result = self.command('install', package=fox, expected='none')
        self.assertEqual(first_result['gameId'], 'studio-signal-fox')
        newer, second = self.package('studio-signal-fox', 2)
        update = self.command('install', package=newer, expected=first_result['activeSha256'])
        rollback = self.command('rollback', game='studio-signal-fox', version=first['version'], expected=update['activeSha256'])
        self.assertEqual(rollback['version'], first['version'])
        self.assertTrue((self.root / 'studio-signal-fox' / 'versions' / second['version']).is_dir())
        self.assertEqual(self.pointer('studio-afterglow').read_bytes(), girl_bytes)
        self.assertEqual(digest(girl_bytes), girl_result['activeSha256'])
        self.assertEqual(self.unrelated.read_text(), 'shared application is unchanged')

    def test_stale_review_cannot_replace_active_game(self):
        source, _ = self.package('studio-signal-fox')
        installed = self.command('install', package=source, expected='none')
        before = self.pointer('studio-signal-fox').read_bytes()
        replacement, _ = self.package('studio-signal-fox', 2)
        self.assertIn('changed since review', self.command('install', package=replacement, expected='none', success=False))
        self.assertEqual(self.pointer('studio-signal-fox').read_bytes(), before)
        self.assertEqual(digest(before), installed['activeSha256'])

    def test_check_has_no_publication_side_effects(self):
        source, _ = self.package('studio-signal-fox')
        result = self.command('check', package=source)
        self.assertTrue(result['verified'])
        self.assertFalse(self.pointer('studio-signal-fox').exists())
        self.assertFalse((self.root / 'studio-signal-fox').exists())
        self.assertFalse((self.state / 'history').exists())

    def test_wrong_game_and_contract_are_rejected(self):
        source, metadata = self.package('studio-signal-fox')
        self.command('check', package=source, game='studio-afterglow', success=False)
        metadata['rulesVersion'] = 2
        (source / 'manifest.json').write_text(json.dumps(metadata))
        self.command('check', package=source, success=False)
        self.assertFalse(self.pointer('studio-signal-fox').exists())

    def test_tampered_or_unlisted_bytes_never_publish(self):
        source, metadata = self.package('studio-signal-fox')
        entry = source / metadata['entry']
        original = entry.read_bytes()
        entry.write_bytes(original + b'changed')
        self.assertIn('hash mismatch', self.command('install', package=source, expected='none', success=False))
        entry.write_bytes(original)
        (source / 'secret.env').write_text('not a permitted resource')
        self.assertIn('Unexpected files', self.command('install', package=source, expected='none', success=False))
        self.assertFalse(self.pointer('studio-signal-fox').exists())

    def test_immutable_version_collision_is_rejected(self):
        original, metadata = self.package('studio-signal-fox')
        installed = self.command('install', package=original, expected='none')
        collision, _ = self.package('studio-signal-fox', suffix='collision')
        self.assertIn('version collision', self.command('install', package=collision, expected=installed['activeSha256'], success=False))
        self.assertEqual(json.loads(self.pointer('studio-signal-fox').read_text())['manifest'], f'/game-modules/studio-signal-fox/versions/{metadata["version"]}/manifest.json')

    def test_symlink_resource_cannot_escape_package(self):
        source, metadata = self.package('studio-signal-fox')
        entry = source / metadata['entry']
        outside = self.base / 'outside.js'
        outside.write_bytes(entry.read_bytes())
        entry.unlink()
        entry.symlink_to(outside)
        self.assertIn('symlink', self.command('install', package=source, expected='none', success=False).lower())
        self.assertFalse(self.pointer('studio-signal-fox').exists())

    def test_default_girlhub_rollback_still_works(self):
        source, first = self.package('studio-afterglow')
        installed = self.command('install', package=source, expected='none')
        newer, _ = self.package('studio-afterglow', 2)
        updated = self.command('install', package=newer, expected=installed['activeSha256'])
        rollback = self.command('rollback', version=first['version'], expected=updated['activeSha256'])
        self.assertEqual(rollback['gameId'], 'studio-afterglow')
        self.assertEqual(rollback['version'], first['version'])

    def test_last_exit_historical_id_is_supported_without_opening_other_github_games(self):
        source, _ = self.package('github-crash')
        installed = self.command('install', package=source, expected='none')
        self.assertEqual(installed['gameId'], 'github-crash')
        self.command('rollback', game='github-mines', version=installed['version'], expected='none', success=False)

    def test_wallet_activity_provider_and_arcade_modules_publish_separately(self):
        previous = {}
        for game in ['royal-mines', 'hockey', 'casinoapipro', 'orbit', 'studio-orbit', 'original-cr-vs-leo']:
            source, _ = self.package(game)
            installed = self.command('install', package=source, expected='none')
            self.assertEqual(installed['gameId'], game)
            self.assertFalse(installed['restartRequired'])
            self.assertFalse(installed['databaseTouched'])
            previous[game] = self.pointer(game).read_bytes()
            for saved_game, saved_bytes in previous.items():
                self.assertEqual(self.pointer(saved_game).read_bytes(), saved_bytes)


if __name__ == '__main__':
    unittest.main()
