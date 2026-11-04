import copy, importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('contact_publisher',Path(__file__).with_name('publish.py'))
pub=importlib.util.module_from_spec(spec);spec.loader.exec_module(pub)

class ScopeTests(unittest.TestCase):
 def test_scope_rejects_another_game_or_source(self):
  before={'sourceCommit':'base'};op={'sourceCommit':'source','baseCommit':'base','buildBaseCommit':'base','source':dict.fromkeys(pub.SOURCES,'new')}
  release={'scope':'modules','modules':[pub.GAME],'build':{'passed':True},'sourceCommit':'source','baseCommit':'base','packages':[{'gameId':pub.GAME}]}
  pub.validate_scope(release,before,op)
  for field,value in [('modules',['royal-roulette']),('baseCommit','other')]:
   bad=copy.deepcopy(release);bad[field]=value
   with self.assertRaises(RuntimeError):pub.validate_scope(bad,before,op)
  op['source']['server/index.ts']='foreign'
  with self.assertRaises(RuntimeError):pub.validate_scope(release,before,op)

 def test_only_pinned_production_inputs_and_the_contact_patch_are_allowed(self):
  before={'sourceLF':{'games/flag-battle/FlagArena.ts':'old'}}
  op={'source':{'games/flag-battle/FlagAudio.ts':'new'}}
  proof={'hostSingletonsExternalized':True,'serverImplementationIncluded':False,'sourceFiles':{'games/flag-battle/FlagArena.ts':'old','games/flag-battle/FlagAudio.ts':'new'}}
  pub.validate_inputs(before,op,proof)
  for name in ['games/flag-battle/FlagArena.ts','server/index.ts']:
   bad=copy.deepcopy(proof);bad['sourceFiles'][name]='unexpected'
   with self.assertRaises(RuntimeError):pub.validate_inputs(before,op,bad)

 def test_full_inventory_preserves_host_and_other_games(self):
  before={'at':1,'availableBytes':100,'source':{'keep':'old'},'sourceLF':{'keep':'old'},'program':{'index.js':'host'},'moduleFiles':{'other/active.json':'other'},'services':{'game':'same'}}
  after=copy.deepcopy(before);source={'games/flag-battle/FlagAudio.ts':'new'}
  after['source'].update(source);after['sourceLF'].update(source)
  prefix=str(pub.MODULES/pub.GAME/'versions'/'new')+'/'
  after['moduleFiles'].update({prefix+'entry.js':'module',str(pub.MODULES/pub.GAME/'active.json'):'pointer'})
  after['at']=2
  pub.validate_after(before,after,source,{'entry.js':'module'},'pointer','new')
  for field in ['program','services','moduleFiles']:
   bad=copy.deepcopy(after);bad[field]['foreign']='changed'
   with self.assertRaises(RuntimeError):pub.validate_after(before,bad,source,{'entry.js':'module'},'pointer','new')

if __name__=='__main__':unittest.main()
