"""Exercise release source selection against actual, isolated Git repositories."""
import ast
from pathlib import Path
import subprocess
import tempfile
import unittest


class PrepareSource(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='royal-source-selection-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.stage = self.root / 'stage'
        self.stage.mkdir()
        self.git('init', '-b', 'main')
        self.expected = [
            'docs/rules.md', 'games/sample/entry.ts', 'public/art.svg',
            'scripts/audit.py', 'server/main.ts', 'src/main.ts',
        ]
        self.put('.gitignore', '__pycache__/\n*.pyc\n.cache/\n')
        for name in [*self.expected, 'README.md', 'package.json', 'deployment/SERVER.md']:
            self.put(name, 'fixture\n')
        self.git('add', '.')
        self.commit('application source')
        self.application = self.git('rev-parse', 'HEAD')
        tree = ast.parse(Path(__file__).with_name('prepare.py').read_text())
        node = next(item for item in tree.body
                    if isinstance(item, ast.FunctionDef) and item.name == 'source_paths')
        namespace = {'Path': Path, 'subprocess': subprocess}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'prepare.py', 'exec'), namespace)
        self.select = namespace['source_paths']

    def git(self, *arguments):
        return subprocess.check_output([
            'git', '-c', 'user.name=Source selection tests',
            '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
            '-c', 'core.hooksPath=/dev/null', *arguments,
        ], cwd=self.stage, text=True, stderr=subprocess.DEVNULL).strip()

    def put(self, name, value):
        path = self.stage / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        return path

    def commit(self, message):
        self.git('commit', '-m', message)

    def selected(self, revision=None):
        return sorted(self.select(self.stage, revision or self.application))

    def test_ignored_bytecode_and_untracked_files_are_not_release_sources(self):
        self.put('scripts/__pycache__/game-module-release.cpython-312.pyc', 'temporary bytecode\n')
        self.put('docs/.cache/result.json', 'temporary cache\n')
        self.put('scripts/untracked-audit.py', 'untracked source\n')
        self.assertEqual(self.git('check-ignore',
            'scripts/__pycache__/game-module-release.cpython-312.pyc'),
            'scripts/__pycache__/game-module-release.cpython-312.pyc')
        self.assertEqual(self.selected(), self.expected)

    def test_explicit_application_revision_controls_selection_instead_of_head_or_index(self):
        self.put('server/later.ts', 'later publisher branch\n')
        self.git('add', 'server/later.ts')
        self.commit('later source')
        self.put('scripts/staged.py', 'staged but not committed\n')
        self.git('add', 'scripts/staged.py')
        self.assertNotEqual(self.git('rev-parse', 'HEAD'), self.application)
        self.assertEqual(self.selected(), self.expected)
        self.assertEqual(self.selected('HEAD'), sorted([*self.expected, 'server/later.ts']))

    def test_tracked_files_outside_the_six_source_roots_are_not_selected(self):
        self.put('unrelated/file.txt', 'outside source roots\n')
        self.git('add', 'unrelated/file.txt')
        self.commit('other tracked file')
        self.assertEqual(self.selected('HEAD'), self.expected)

    def test_nul_delimited_git_output_preserves_spaces_unicode_and_newlines(self):
        names = ['docs/with space.md', 'public/пример.svg', 'scripts/line\nbreak.py']
        for name in names:
            self.put(name, 'tracked path\n')
            self.git('add', '--', name)
        self.commit('unusual tracked filenames')
        self.assertEqual(self.selected('HEAD'), sorted([*self.expected, *names]))

    def test_tracked_generated_private_and_snapshot_excluded_paths_are_rejected(self):
        names = [
            'scripts/__pycache__/bad.pyc', 'docs/.env.local', 'scripts/node_modules/x.js',
            'docs/data/fixture.json', 'server/secrets/fixture.txt', 'src/._temporary.ts',
            'public/.DS_Store', 'docs/stale.orig', 'docs/stale.bak',
            'scripts/cache.pyc', 'scripts/cache.pyo',
        ]
        for name in names:
            with self.subTest(path=name):
                self.put(name, 'fixture only\n')
                self.git('add', '-f', '--', name)
                self.commit('tracked invalid fixture')
                try:
                    with self.assertRaisesRegex(AssertionError, 'Excluded tracked source|Generated tracked source'):
                        self.selected('HEAD')
                finally:
                    self.git('rm', '--', name)
                    self.commit('remove invalid fixture')

    def test_tracked_file_symlink_is_rejected(self):
        link = self.stage / 'docs/link.md'
        link.symlink_to('../src/main.ts')
        self.git('add', 'docs/link.md')
        self.commit('tracked symlink')
        with self.assertRaisesRegex(AssertionError, 'Invalid tracked source'):
            self.selected('HEAD')

    def test_tracked_regular_file_replaced_by_a_symlink_is_rejected(self):
        target = self.root / 'outside.ts'
        target.write_text('fixture\n')
        source = self.stage / 'src/main.ts'
        source.unlink()
        source.symlink_to(target)
        with self.assertRaisesRegex(AssertionError, 'Invalid tracked source'):
            self.selected()

    def test_missing_tracked_source_is_rejected(self):
        (self.stage / 'server/main.ts').unlink()
        with self.assertRaisesRegex(AssertionError, 'Invalid tracked source'):
            self.selected()

    def test_source_directory_replaced_by_a_symlink_is_rejected(self):
        outside = self.root / 'outside-src'
        source = self.stage / 'src'
        source.rename(outside)
        source.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(AssertionError, 'symlink'):
            self.selected()


if __name__ == '__main__':
    unittest.main()
