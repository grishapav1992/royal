import importlib.util,unittest,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Guards(unittest.TestCase):
 def test_only_exact_committed_hall_labels_may_advance_the_prepared_host(self):
  contract={'games':{p.GAME:p.CONTRACT}}
  before={'sourceCommit':'8616f86d5c31ee81abdcd18484de0d4c1a2446e4','container':{'health':'healthy'},'source':{'src/game/interiorArt.ts':'old','games/wild-nudge/GalacticReactorUI.ts':'old-ui'},'sourceLF':{},'configHashes':{},'protectedPrograms':{},'realMoneyFlags':{},'moduleFiles':{},'moduleHostContract':'contract','moduleHost':contract,'services':{'/royal-game-1':'old','/finance':'retained'},'serviceProfiles':{'royal-game-1':'old','finance':'retained'}}
  proof={'version':'1.5.0-dfaacbc6bb0f','sourceSha256':'dfaacbc6bb0fd204ad71935485c12c645c3d36a5c18fdfa296bf91a443bb55ef','hostSingletonsExternalized':True,'serverImplementationIncluded':False,'sourceFiles':{}}
  before['program']={'dist-server/index.js':'backend','dist/index.html':'old-page'}
  p.validate_compatible_host(before,before,{},proof,{})
  current=copy.deepcopy(before);current['sourceCommit']='5538f71e3c1d61ebdd8e73a43a395dfcaec22a6e';current['source'].update(p.ALLOWED_HALL_SOURCE);current['services']['/royal-game-1']='new';current['serviceProfiles']['royal-game-1']='new'
  p.validate_compatible_host(before,current,{},proof,{})
  wrong=copy.deepcopy(current);wrong['program']['dist-server/index.js']='changed'
  with self.assertRaises(RuntimeError):p.validate_compatible_host(before,wrong,{},proof,{})
  for key in ['configHashes','protectedPrograms','realMoneyFlags','moduleFiles','moduleHost','services','serviceProfiles']:
   wrong=copy.deepcopy(current);wrong[key]['foreign']='changed'
   with self.assertRaises(RuntimeError):p.validate_compatible_host(before,wrong,{},proof,{})
  for name in ['games/wild-nudge/GalacticReactorUI.ts','src/shared/wildNudgeMath.ts','src/game/interiorArt.ts']:
   wrong=copy.deepcopy(current);wrong['source'][name]='unreviewed'
   with self.assertRaises(RuntimeError):p.validate_compatible_host(before,wrong,{},proof,{})
  wrong=copy.deepcopy(current);wrong['sourceCommit']='a'*40
  with self.assertRaises(RuntimeError):p.validate_compatible_host(before,wrong,{},proof,{})
 def test_line_endings_exception_reconstructs_exact_bytes_and_rejects_code_changes(self):
  import tempfile,hashlib
  from unittest.mock import patch
  name='src/shared/wildNudgeMath.ts';content=b'export const value=1;\n';lf=hashlib.sha256(content).hexdigest();crlf=hashlib.sha256(content.replace(b'\n',b'\r\n')).hexdigest()
  proof={'version':'1.5.0-dfaacbc6bb0f','sourceSha256':'dfaacbc6bb0fd204ad71935485c12c645c3d36a5c18fdfa296bf91a443bb55ef','hostSingletonsExternalized':True,'serverImplementationIncluded':False,'sourceFiles':{name:crlf}}
  before={'source':{name:lf},'sourceLF':{name:lf}};equivalence={'rows':{name:{'kind':'line-endings-only','inputSha256':crlf,'productionLFSha256':lf}}}
  with tempfile.TemporaryDirectory() as directory,patch.object(p,'LIVE',Path(directory)):
   target=Path(directory)/name;target.parent.mkdir(parents=True);target.write_bytes(content)
   p.validate_inputs(before,{},proof,equivalence)
   target.write_bytes(b'export const value=2;\n')
   with self.assertRaises(RuntimeError):p.validate_inputs(before,{},proof,equivalence)
 def test_unchanged_mathematics_and_dependencies_must_match_the_live_sources(self):
  before={'source':{'src/shared/wildNudgeMath.ts':'math'},'sourceLF':{'src/shared/wildNudgeMath.ts':'math'}}
  op={'source':{p.SOURCES[0]:'ui'}}
  proof={'version':'1.5.0-dfaacbc6bb0f','sourceSha256':'dfaacbc6bb0fd204ad71935485c12c645c3d36a5c18fdfa296bf91a443bb55ef','hostSingletonsExternalized':True,'serverImplementationIncluded':False,'sourceFiles':{'src/shared/wildNudgeMath.ts':'math',p.SOURCES[0]:'ui'}}
  p.validate_inputs(before,op,proof)
  for path,digest in [('src/shared/wildNudgeMath.ts','changed'),('node_modules/other/code.js','changed')]:
   changed=copy.deepcopy(proof);changed['sourceFiles'][path]=digest
   with self.assertRaises(RuntimeError):p.validate_inputs(before,op,changed)
 def test_only_star_spin_and_its_exact_source_scope_are_allowed(self):
  release={'scope':'modules','modules':['wild-nudge'],'build':{'passed':True},'sourceCommit':'a'*40,'baseCommit':'b'*40,'packages':[{'gameId':p.GAME,'version':'1.5.0-dfaacbc6bb0f'}]};before={'sourceCommit':'b'*40};op={'sourceCommit':'a'*40,'source':dict.fromkeys(p.SOURCES,'x')}
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
