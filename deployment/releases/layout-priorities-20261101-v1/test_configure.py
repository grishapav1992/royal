import json, unittest
from configure import layout_overlay

class SourceOverlay(unittest.TestCase):
    def test_package_version_cannot_replace_a_rules_digit(self):
        old={'version':'1.2.0','rulesVersion':2,'progressVersion':4}
        new={**old,'version':'1.3.0'}
        live={'version':'1.1.0','rulesVersion':2,'progressVersion':3}
        value,_=layout_overlay('games/girlhub/package.json',json.dumps(old),json.dumps(new),json.dumps(live))
        self.assertEqual(json.loads(value),{**live,'version':'1.3.0'})
    def test_unrelated_published_lines_survive_the_layout_patch(self):
        old='export class View {\n  private root = document.createElement("section");\n  oldFeature();\n}\n'
        new=old.replace('  private root','  private layout: Layout;\n  private root')
        live=old.replace('oldFeature();','publishedFeature();')
        result,_=layout_overlay('src/ui/View.ts',old,new,live)
        self.assertIn('publishedFeature();',result);self.assertIn('private layout: Layout;',result)
    def test_already_published_layout_is_not_applied_twice(self):
        old='export class View {\n  private root = document.createElement("section");\n  oldFeature();\n}\n'
        new=old.replace('  private root','  private layout: Layout;\n  private root')
        live=new.replace('oldFeature();','publishedFeature();')
        result,patches=layout_overlay('src/ui/View.ts',old,new,live)
        self.assertEqual(result,live);self.assertEqual(patches,[])
    def test_dictionary_keeps_concurrent_translations(self):
        header='export const english: Record<string, string> = {\n'
        old=header+'  "old": "Old",\n};\n'
        new=header+'  "chat": "Chat",\n'+old[len(header):]
        live=header+'  "elevator": "Elevator",\n'+old[len(header):]
        result,_=layout_overlay('src/i18n/en.ts',old,new,live)
        self.assertIn('"elevator": "Elevator"',result)
        self.assertEqual(result.count('"chat": "Chat"'),1)
        again,patches=layout_overlay('src/i18n/en.ts',old,new,result)
        self.assertEqual(again,result);self.assertEqual(patches,[])

if __name__=='__main__':unittest.main()
