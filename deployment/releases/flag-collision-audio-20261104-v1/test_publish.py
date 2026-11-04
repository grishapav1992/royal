import copy, importlib.util, unittest, tempfile, fcntl
from unittest.mock import patch
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

class PublicationLockTests(unittest.TestCase):
 def setUp(self):
  self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
  self.locks=[Path(self.directory.name)/str(i) for i in range(3)]
  context=patch.object(pub,'LOCKS',self.locks);context.start();self.addCleanup(context.stop)

 def assert_available(self):
  for path in self.locks:
   with path.open('a') as handle:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)

 def test_all_locks_held_only_in_critical_section(self):
  self.assert_available()
  with pub.publication_locks():
   for path in self.locks:
    with path.open('a') as handle:
     with self.assertRaises(BlockingIOError):fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  self.assert_available()

 def test_busy_last_lock_closes_partial_descriptors(self):
  with self.locks[2].open('a') as blocker:
   fcntl.flock(blocker,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(pub.PublicationBusy):
    with pub.publication_locks():self.fail('Entered busy publication')
   for path in self.locks[:2]:
    with path.open('a') as handle:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  self.assert_available()

 def test_failure_releases_every_lock(self):
  with self.assertRaisesRegex(RuntimeError,'failed'):
   with pub.publication_locks():raise RuntimeError('failed')
  self.assert_available()

 def test_busy_cli_returns_75_without_retry(self):
  with patch.object(pub,'main',side_effect=pub.PublicationBusy('busy')) as main:
   self.assertEqual(pub.cli(),75);main.assert_called_once()

 def test_symlink_rejection_releases_partial_descriptors(self):
  target=Path(self.directory.name)/'target';target.touch();self.locks[1].symlink_to(target)
  with self.assertRaisesRegex(RuntimeError,'symlink'):
   with pub.publication_locks():self.fail('Accepted symlink')
  self.locks[1].unlink();self.assert_available()

if __name__=='__main__':unittest.main()
