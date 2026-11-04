import importlib.util,unittest,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Guards(unittest.TestCase):
 def test_every_live_source_runtime_module_and_service_must_stay_identical(self):
  before={'sourceCommit':'5538f71e3c1d61ebdd8e73a43a395dfcaec22a6e','container':{'health':'healthy'},'source':{},'sourceLF':{},'configHashes':{},'protectedPrograms':{},'realMoneyFlags':{},'moduleFiles':{},'moduleHostContract':'contract','moduleHost':{'games':{p.GAME:p.CONTRACT}},'services':{},'serviceProfiles':{},'program':{'dist-server/index.js':'backend'}}
  proof={'version':'1.5.1-a6511d3f697d','sourceSha256':'a6511d3f697d1e0ef55267bdcaf58e96dfe6213d60d99dcf69284fbd22a84ff7','hostSingletonsExternalized':True,'serverImplementationIncluded':False,'sourceFiles':{}}
  p.validate_compatible_host(before,copy.deepcopy(before),{},proof,{})
  for key in ['source','sourceLF','configHashes','protectedPrograms','moduleFiles','services','program','moduleHost']:
   changed=copy.deepcopy(before);changed[key]['foreign']='changed'
   with self.assertRaises(RuntimeError):p.validate_compatible_host(before,changed,{},proof,{})
 def test_line_endings_exception_reconstructs_exact_bytes_and_rejects_code_changes(self):
  import tempfile,hashlib
  from unittest.mock import patch
  name='src/shared/wildNudgeMath.ts';content=b'export const value=1;\n';lf=hashlib.sha256(content).hexdigest();crlf=hashlib.sha256(content.replace(b'\n',b'\r\n')).hexdigest()
  proof={'version':'1.5.1-a6511d3f697d','sourceSha256':'a6511d3f697d1e0ef55267bdcaf58e96dfe6213d60d99dcf69284fbd22a84ff7','hostSingletonsExternalized':True,'serverImplementationIncluded':False,'sourceFiles':{name:crlf}}
  before={'source':{name:lf},'sourceLF':{name:lf}};equivalence={'rows':{name:{'kind':'line-endings-only','inputSha256':crlf,'productionLFSha256':lf}}}
  with tempfile.TemporaryDirectory() as directory,patch.object(p,'LIVE',Path(directory)):
   target=Path(directory)/name;target.parent.mkdir(parents=True);target.write_bytes(content)
   p.validate_inputs(before,{},proof,equivalence)
   target.write_bytes(b'export const value=2;\n')
   with self.assertRaises(RuntimeError):p.validate_inputs(before,{},proof,equivalence)
 def test_unchanged_mathematics_and_dependencies_must_match_the_live_sources(self):
  before={'source':{'src/shared/wildNudgeMath.ts':'math'},'sourceLF':{'src/shared/wildNudgeMath.ts':'math'}}
  op={'source':{p.SOURCES[0]:'ui'}}
  proof={'version':'1.5.1-a6511d3f697d','sourceSha256':'a6511d3f697d1e0ef55267bdcaf58e96dfe6213d60d99dcf69284fbd22a84ff7','hostSingletonsExternalized':True,'serverImplementationIncluded':False,'sourceFiles':{'src/shared/wildNudgeMath.ts':'math',p.SOURCES[0]:'ui'}}
  p.validate_inputs(before,op,proof)
  for path,digest in [('src/shared/wildNudgeMath.ts','changed'),('node_modules/other/code.js','changed')]:
   changed=copy.deepcopy(proof);changed['sourceFiles'][path]=digest
   with self.assertRaises(RuntimeError):p.validate_inputs(before,op,changed)
 def test_only_star_spin_and_its_exact_source_scope_are_allowed(self):
  release={'scope':'modules','modules':['wild-nudge'],'build':{'passed':True},'sourceCommit':'a'*40,'baseCommit':'b'*40,'packages':[{'gameId':p.GAME,'version':'1.5.1-a6511d3f697d'}]};before={'sourceCommit':'b'*40};op={'sourceCommit':'a'*40,'source':dict.fromkeys(p.SOURCES,'x')}
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
