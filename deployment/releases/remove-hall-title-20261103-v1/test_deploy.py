import ast, unittest
from pathlib import Path

tree = ast.parse((Path(__file__).parent / 'deploy.py').read_text(encoding='utf-8'))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ['require','validate_inputs']]
scope = {'SOURCE': 'src/game/interiorArt.ts'}
exec(compile(ast.Module(body=functions, type_ignores=[]), '<wall-release-guards>', 'exec'), scope)

class ScopeTests(unittest.TestCase):
    def test_only_wall_source_changes(self):
        scope['validate_inputs']({'src/game/interiorArt.ts':'new'}, {'inputs':{'src/game/interiorArt.ts':'new','src/shared/world.ts':'old'}}, {'source':{'src/shared/world.ts':'old'},'sourceLF':{}})

    def test_unrelated_input_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Unrelated host input'):
            scope['validate_inputs']({'src/game/interiorArt.ts':'new'}, {'inputs':{'src/game/interiorArt.ts':'new','src/shared/world.ts':'foreign'}}, {'source':{'src/shared/world.ts':'old'},'sourceLF':{}})

    def test_unbound_source_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'not bound'):
            scope['validate_inputs']({'src/game/interiorArt.ts':'new'}, {'inputs':{'src/game/interiorArt.ts':'old'}}, {'source':{},'sourceLF':{}})

    def test_backend_scope_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'source scope'):
            scope['validate_inputs']({'server/index.ts':'new'}, {'inputs':{}}, {'source':{},'sourceLF':{}})

if __name__ == '__main__': unittest.main()
