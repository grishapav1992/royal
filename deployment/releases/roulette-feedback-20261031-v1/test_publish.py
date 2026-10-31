import importlib.util,unittest,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Guards(unittest.TestCase):
 def test_only_roulette_and_its_exact_source_scope_are_allowed(self):
  release={'scope':'modules','modules':[p.GAME],'build':{'passed':True},'sourceCommit':'a'*40,'baseCommit':'b'*40,'packages':[{'gameId':p.GAME}]};before={'sourceCommit':'b'*40};op={'sourceCommit':'a'*40,'source':dict.fromkeys(p.SOURCES,'x')}
  p.validate_scope(release,before,op)
  for changed in [{**release,'scope':'application'},{**release,'modules':['girlhub']},{**release,'baseCommit':'c'*40}]:
   with self.assertRaises(RuntimeError):p.validate_scope(changed,before,op)
  with self.assertRaises(RuntimeError):p.validate_scope(release,before,{**op,'source':{**op['source'],'server/index.ts':'x'}})
 def test_exact_image_target_is_read_without_layer_size_estimates(self):
  ref='docker.io/library/royal-game:latest';digest='sha256:'+'a'*64
  self.assertEqual(p.image_digest('REF TYPE DIGEST SIZE\n'+ref+' manifest '+digest+' 1.2GiB\n',ref),digest)
  for text in ['', 'REF TYPE DIGEST\n'+ref+' manifest unknown', 'REF TYPE DIGEST\nother manifest '+digest, 'REF TYPE DIGEST\n'+(ref+' manifest '+digest+'\n')*2]:
   with self.assertRaises(RuntimeError):p.image_digest(text,ref)
 def test_postcheck_rejects_any_foreign_source_runtime_service_or_old_module_change(self):
  before={'at':1,'availableBytes':10,'source':{'old':'x'},'sourceLF':{'old':'x'},'moduleFiles':{'other/active.json':'old'},'program':{'index.js':'x'},'services':{'game':'same'}}
  after=copy.deepcopy(before);after['source']['new']='y';after['sourceLF']['new']='y';after['at']=2;after['availableBytes']=9
  prefix=str(p.MODULES/p.GAME/'versions'/'1.5.0-test')+'/'
  after['moduleFiles'][prefix+'manifest.json']='m';after['moduleFiles'][str(p.MODULES/p.GAME/'active.json')]='pointer'
  p.validate_after(before,after,{'new':'y'},{'manifest.json':'m'},'pointer','1.5.0-test')
  for key in ['source','sourceLF','moduleFiles','program','services']:
   changed=copy.deepcopy(after);changed[key]['foreign']='bad'
   with self.assertRaises(RuntimeError):p.validate_after(before,changed,{'new':'y'},{'manifest.json':'m'},'pointer','1.5.0-test')
if __name__=='__main__':unittest.main()
