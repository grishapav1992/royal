import copy,importlib.util,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

def fixture():
 inputs={**dict.fromkeys(p.SOURCES,'new'),'src/shared/unchanged.ts':'preserved'}
 pointers={g:'old-'+g for g in p.GAMES.values()}
 before={'sourceCommit':'b'*40,'sourceLF':{'src/shared/unchanged.ts':'preserved'},'moduleFiles':{str(p.MODULES/g/'active.json'):v for g,v in pointers.items()}}
 release={'scope':'modules','modules':list(p.GAMES),'build':{'passed':True},'sourceCommit':'a'*40,'baseCommit':'b'*40,'packages':[{'gameId':g} for g in p.GAMES.values()],'moduleProjection':{'productionCommit':'b'*40,'inputs':inputs}}
 operator={'sourceCommit':'a'*40,'source':dict.fromkeys(p.SOURCES,'new'),'beforePointers':pointers}
 return release,before,operator

class Guards(unittest.TestCase):
 def test_exact_active_package_and_source_scope(self):
  release,before,operator=fixture();p.validate_scope(release,before,operator)
  for changed in [{**release,'scope':'application'},{**release,'modules':['girlhub']},{**release,'baseCommit':'c'*40},{**release,'packages':[{'gameId':'royal-coins'}]}]:
   with self.assertRaises(RuntimeError):p.validate_scope(changed,before,operator)
  with self.assertRaises(RuntimeError):p.validate_scope(release,before,{**operator,'source':{**operator['source'],'server/index.ts':'bad'}})
  missing=copy.deepcopy(release);missing['moduleProjection']['inputs'].pop(next(iter(p.ADDED)))
  with self.assertRaises(RuntimeError):p.validate_scope(missing,before,operator)

 def test_current_program_inputs_and_active_pointers_must_match_review(self):
  release,before,operator=fixture()
  changed=copy.deepcopy(before);changed['sourceLF']['src/shared/unchanged.ts']='different'
  with self.assertRaises(RuntimeError):p.validate_scope(release,changed,operator)
  changed=copy.deepcopy(before);changed['moduleFiles'][str(p.MODULES/next(iter(p.GAMES.values()))/'active.json')]='a-newer-release'
  with self.assertRaises(RuntimeError):p.validate_scope(release,changed,operator)

 def test_published_package_inputs_do_not_hide_an_intervening_source_change(self):
  release,before,operator=fixture()
  for name,row in p.PUBLISHED_INPUTS.items():
   release['moduleProjection']['inputs'][name]=row['sha256']
   if row['serverSourceSha256'] is not None:before['sourceLF'][name]=row['serverSourceSha256']
  p.validate_scope(release,before,operator)
  name=next(iter(p.PUBLISHED_INPUTS));before['sourceLF'][name]='unreviewed'
  with self.assertRaises(RuntimeError):p.validate_scope(release,before,operator)

 def test_program_receipt_binds_both_immutable_entries(self):
  before={'entry':'old.js','files':{'old.js':'old'}};after={'entry':'new.js','files':{'new.js':'new'}}
  for game in p.GAMES.values():
   kind='style-composition-only' if game=='studio-dracona' else 'coordinate-only' if game in {'studio-cosmic-escape','studio-velvet-reign'} else 'alpha-equal'
   row={'kind':kind,'passed':True,'beforeManifest':'a','afterManifest':'b','beforeEntry':'old','afterEntry':'new','coordinateTableSha256':'0f00e5a6178c774f48bd3eb03588acc7edd4c46e87545df35f3316bbdde91582','onlyImportedValue':'LINES'}
   p.validate_program(game,row,before,after,'a','b')
   for change in [{'afterEntry':'wrong'},{'beforeEntry':'wrong'},{'passed':False},{'kind':'unreviewed'}]:
    with self.assertRaises(RuntimeError):p.validate_program(game,{**row,**change},before,after,'a','b')
 def test_image_metadata_requires_exact_running_identity_and_tag(self):
  digest='sha256:'+'a'*64
  with patch.object(p,'command',return_value=digest):
   helper=types.SimpleNamespace(image_metadata=lambda identity:{'Id':digest,'RepoTags':['royal-game:latest']})
   with patch.object(p,'load',return_value=helper):self.assertEqual(p.image('royal-game:latest'),digest)
   for metadata in [None,{'Id':'sha256:'+'b'*64,'RepoTags':['royal-game:latest']},{'Id':digest,'RepoTags':[]}]:
    helper=types.SimpleNamespace(image_metadata=lambda identity,value=metadata:value)
    with patch.object(p,'load',return_value=helper):
     with self.assertRaises(RuntimeError):p.image('royal-game:latest')

 def test_complete_postcheck_accepts_only_reviewed_sources_and_packages(self):
  before={'at':1,'availableBytes':100,'source':{'existing.ts':'old'},'sourceLF':{'existing.ts':'old'},'moduleFiles':{'other/active.json':'old'},'program':{'index.js':'x'},'services':{'game':'same'},'configuration':'same','moduleHostContract':'same'}
  packages={g:{'version':'1.0.0-test','files':{'manifest.json':'m'},'pointerSha256':'p'} for g in p.GAMES.values()}
  source={**dict.fromkeys(p.ADDED,'new'),'existing.ts':'changed'}
  after=copy.deepcopy(before);after['source'].update(source);after['sourceLF'].update(source)
  for g,row in packages.items():
   after['moduleFiles'][str(p.MODULES/g/'versions'/row['version']/'manifest.json')]='m'
   after['moduleFiles'][str(p.MODULES/g/'active.json')]='p'
  p.validate_after(before,after,source,packages)
  for key in ['source','sourceLF','moduleFiles','program','services']:
   changed=copy.deepcopy(after);changed[key]['foreign']='bad'
   with self.assertRaises(RuntimeError):p.validate_after(before,changed,source,packages)
  for key in ['configuration','moduleHostContract']:
   changed=copy.deepcopy(after);changed[key]='changed'
   with self.assertRaises(RuntimeError):p.validate_after(before,changed,source,packages)

if __name__=='__main__':unittest.main()
