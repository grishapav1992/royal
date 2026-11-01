import importlib.util,unittest,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Guards(unittest.TestCase):
 def test_only_caribbean_and_its_exact_source_scope_are_allowed(self):
  release={'scope':'modules','modules':['caribbean-treasures'],'build':{'passed':True},'sourceCommit':'a'*40,'baseCommit':'b'*40,'packages':[{'gameId':p.GAME}]};before={'sourceCommit':'b'*40};op={'sourceCommit':'a'*40,'source':dict.fromkeys(p.SOURCES,'x')}
  p.validate_scope(release,before,op)
  for changed in [{**release,'scope':'application'},{**release,'modules':['girlhub']},{**release,'baseCommit':'c'*40}]:
   with self.assertRaises(RuntimeError):p.validate_scope(changed,before,op)
  with self.assertRaises(RuntimeError):p.validate_scope(release,before,{**op,'source':{**op['source'],'server/index.ts':'x'}})
 def test_image_identity_requires_the_exact_running_tag_without_size_traversal(self):
  from unittest.mock import patch,Mock
  helper=Mock();helper.image_metadata.return_value={'Id':'sha256:'+'a'*64,'RepoTags':['royal-game:latest']}
  with patch.object(p,'command',return_value='sha256:'+'a'*64) as command,patch.object(p,'load',return_value=helper):
   self.assertEqual(p.image('royal-game:latest'),'sha256:'+'a'*64)
   self.assertEqual(command.call_args.args[0],['docker','container','inspect','royal-game-1','--format','{{.Image}}'])
   with self.assertRaises(RuntimeError):p.image('royal-game:other')
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
