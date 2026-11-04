import copy, importlib.util, sys, types, unittest
from pathlib import Path
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.ModuleType('fcntl'))
spec = importlib.util.spec_from_file_location('selection_release', Path(__file__).with_name('deploy.py'))
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)


class Guards(unittest.TestCase):
    def test_backend_inputs_must_match_live_except_exact_selection_and_preserved_dictionary(self):
        before = {'source': {'server/starSpinCollection.ts':'old', 'server/demoWallet.ts':'money', 'src/i18n/en.ts':'new-dictionary'}, 'sourceLF': {}}
        graph = {'inputs': {'server/starSpinCollection.ts':'free', 'server/demoWallet.ts':'money', 'src/i18n/en.ts':'old-dictionary'}}
        p.validate_inputs(graph, before, {'server/starSpinCollection.ts':'free'}, {'src/i18n/en.ts':'old-dictionary'})
        for name in ['server/demoWallet.ts', 'src/shared/wildNudgeMath.ts', 'src/i18n/en.ts']:
            wrong = copy.deepcopy(graph); wrong['inputs'][name] = 'foreign'
            with self.assertRaises(RuntimeError): p.validate_inputs(wrong, before, {'server/starSpinCollection.ts':'free'}, {'src/i18n/en.ts':'old-dictionary'})

    def test_new_package_preserves_every_other_version_and_pointer(self):
        before = {'/other/active.json':'other', '/old/manifest.json':'old'}
        m = {'before': {'moduleFiles': before}, 'package': {'version':'1.6.0-test', 'files':{'manifest.json':'manifest','main.js':'program'}, 'pointerSha256':'pointer'}}
        actual = p.expected_modules(m)
        self.assertEqual(len(actual), 5)
        self.assertTrue(all(actual[n] == h for n,h in before.items()))
        self.assertEqual(before, m['before']['moduleFiles'])

    def test_after_activation_accepts_only_exact_new_module_inventory(self):
        app = {'at':1, 'availableBytes':10, 'source':{'selection':'new'}, 'container':{'image':'new','health':'healthy'}, 'program':{'index.js':'new'}, 'moduleFiles':{'old':'old'}, 'services':{'money':'same'}, 'configHashes':{'env':'same'}}
        after = copy.deepcopy(app); after.update(at=2, availableBytes=9, moduleFiles={'old':'old','new':'new'})
        p.validate_after(app, after, after['moduleFiles'])
        for key in ['source','container','program','moduleFiles','services','configHashes']:
            wrong = copy.deepcopy(after); wrong[key]['foreign'] = 'bad'
            with self.assertRaises(RuntimeError): p.validate_after(app, wrong, after['moduleFiles'])


if __name__ == '__main__': unittest.main()
