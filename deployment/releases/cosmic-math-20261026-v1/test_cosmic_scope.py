import ast
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
tree = ast.parse((HERE/'prepare.py').read_text())
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {'cosmic_source', 'dependency_transition', 'unchanged_dependencies'}]
namespace = {'Path': Path, 'json': json}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(HERE/'prepare.py'), 'exec'), namespace)
scope = namespace['cosmic_source']
transition = namespace['dependency_transition']
unchanged = namespace['unchanged_dependencies']
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


class CosmicScopeTests(unittest.TestCase):
    def test_only_cosmic_client_is_selected(self):
        source = ast.parse((HERE/'modules.py').read_text())
        games = next(ast.literal_eval(node.value) for node in source.body
                     if isinstance(node, ast.Assign) and any(isinstance(name, ast.Name) and name.id == 'GAMES'
                                                            for name in node.targets))
        self.assertEqual(games, ('studio-cosmic-escape',))

    def test_cosmic_math_and_qualification_are_allowed(self):
        for name in ['src/shared/luelonSlotsLines.ts', 'scripts/check-game-rtp.mjs',
                     'scripts/game-math/cosmic-qualification.mjs',
                     'docs/game-math/qualifications/cosmic-v3.json']:
            self.assertTrue(scope(name), name)

    def test_unrelated_runtime_paths_are_rejected(self):
        for name in ['server/LobbyRoom.ts', 'games/mortal-kombat/src/main.ts',
                     'src/shared/caramelMath.ts', 'public/unrelated.webp',
                     'games/studio-neopolis/index.ts']:
            self.assertFalse(scope(name), name)

    def locks(self):
        return {'packages': {'': {'name': 'host'},
                'node_modules/body-parser': {'version': '2.4.0'},
                'node_modules/qs': {'version': '6.16.1'},
                'node_modules/other': {'version': '1.0.0'}}}

    def test_already_installed_security_dependencies_are_preserved(self):
        data = self.locks()
        original = copy.deepcopy(data)
        self.assertEqual(transition(data, copy.deepcopy(data)), set())
        self.assertEqual(data, original)

    def test_security_dependency_upgrade_is_outside_cosmic_scope(self):
        new = self.locks()
        old = copy.deepcopy(new)
        old['packages']['node_modules/body-parser']['version'] = '2.3.0'
        old['packages']['node_modules/qs']['version'] = '6.14.0'
        with self.assertRaises(AssertionError):
            transition(old, new)

    def test_unrelated_dependency_change_is_rejected(self):
        old = self.locks()
        new = copy.deepcopy(old)
        new['packages']['node_modules/other']['version'] = '2.0.0'
        with self.assertRaises(AssertionError):
            transition(old, new)

    def test_dependency_inventory_change_is_rejected(self):
        old = self.locks()
        new = copy.deepcopy(old)
        new['packages']['node_modules/new'] = {'version': '1.0.0'}
        with self.assertRaises(AssertionError):
            transition(old, new)

    def fixture(self, root):
        program = {}
        for name, version in [('body-parser', '2.4.0'), ('qs', '6.16.1')]:
            folder = root/'node_modules'/name
            folder.mkdir(parents=True)
            (folder/'package.json').write_text(json.dumps({'version': version}))
            (folder/'index.js').write_text('module.exports = {};\n')
            for path in folder.iterdir():
                program[path.relative_to(root).as_posix()] = sha(path)
        return {'program': program}

    def test_unchanged_packages_require_all_running_bytes_to_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = self.fixture(root)
            unchanged(root, before, sha)
            (root/'node_modules/qs/index.js').write_text('tampered\n')
            with self.assertRaises(AssertionError):
                unchanged(root, before, sha)

    def test_obsolete_runtime_dependency_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = self.fixture(root)
            before['program']['node_modules/qs/obsolete.js'] = '0'*64
            with self.assertRaises(AssertionError):
                unchanged(root, before, sha)

    def test_dependency_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = self.fixture(root)
            (root/'node_modules/qs/link.js').symlink_to('index.js')
            with self.assertRaises(AssertionError):
                unchanged(root, before, sha)

    def test_wrong_installed_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = self.fixture(root)
            (root/'node_modules/qs/package.json').write_text(json.dumps({'version': '6.14.0'}))
            with self.assertRaises(AssertionError):
                unchanged(root, before, sha)


if __name__ == '__main__':
    unittest.main()
