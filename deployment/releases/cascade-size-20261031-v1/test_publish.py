import importlib.util,unittest,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Guards(unittest.TestCase):
 def test_only_temple_and_its_exact_source_scope_are_allowed(self):
  release={'scope':'modules','modules':list(p.GAMES),'build':{'passed':True},'sourceCommit':'a'*40,'baseCommit':'b'*40,'packages':[{'gameId':g} for g in p.GAMES.values()],'moduleProjection':{'productionCommit':'b'*40}};before={'sourceCommit':'b'*40};op={'sourceCommit':'a'*40,'source':dict.fromkeys(p.SOURCES,'x')}
  p.validate_scope(release,before,op)
  for changed in [{**release,'scope':'application'},{**release,'modules':['girlhub']},{**release,'baseCommit':'c'*40}]:
   with self.assertRaises(RuntimeError):p.validate_scope(changed,before,op)
  with self.assertRaises(RuntimeError):p.validate_scope(release,before,{**op,'source':{**op['source'],'server/index.ts':'x'}})
 def test_exact_image_target_is_read_without_layer_size_estimates(self):
  ref='docker.io/library/royal-game:latest';digest='sha256:'+'a'*64
  self.assertEqual(p.image_digest('REF TYPE DIGEST SIZE\n'+ref+' manifest '+digest+' 1.2GiB\n',ref),digest)
  for text in ['', 'REF TYPE DIGEST\n'+ref+' manifest unknown', 'REF TYPE DIGEST\nother manifest '+digest, 'REF TYPE DIGEST\n'+(ref+' manifest '+digest+'\n')*2]:
   with self.assertRaises(RuntimeError):p.image_digest(text,ref)

if __name__=='__main__':unittest.main()
