import importlib.util,sys,types,unittest
from pathlib import Path
if sys.platform=='win32':sys.modules.setdefault('fcntl',types.SimpleNamespace())
spec=importlib.util.spec_from_file_location('tsu_cleanup',Path(__file__).with_name('cleanup.py'))
cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)
class CleanupBoundary(unittest.TestCase):
    def test_unchanged_live_contract_is_valid_only_for_the_verified_successor(self):
        self.assertTrue(cleanup.valid_host_rollback(False,None,'matching','matching'))
        self.assertTrue(cleanup.valid_host_rollback(True,'matching','new-contract','matching'))
        self.assertFalse(cleanup.valid_host_rollback(True,None,'matching','matching'))
        self.assertFalse(cleanup.valid_host_rollback(False,None,'changed','matching'))
    def test_only_a_verified_immediate_successor_can_replace_the_current_image_guard(self):
        p={'published':True,'runningImage':'new','sourceCommit':'new-source'}
        m={'sourceCommit':'new-source','before':{'preparedImage':'old','sourceCommit':'old-source'}}
        b={'image':'new'};receipt={'sourceCommit':'new-source','remoteMain':'a'*40}
        self.assertTrue(cleanup.valid_successor('new','new-source','old','old-source',p,m,b,receipt))
        for wrong in [{**m,'before':{'preparedImage':'different','sourceCommit':'old-source'}},{**m,'sourceCommit':'unknown'}]:
            self.assertFalse(cleanup.valid_successor('new','new-source','old','old-source',p,wrong,b,receipt))
        self.assertFalse(cleanup.valid_successor('new','new-source','old','old-source',{**p,'published':False},m,b,receipt))
    def test_context_binds_both_programs_and_revision(self):
        m={'release':'tsu','sourceCommit':'a'*40,'delta':{'index.html':'client'},'serverDelta':{'index.js':'server'}}
        actual=cleanup.context_expected(m)
        self.assertEqual(actual['dist-delta/index.html'],'client');self.assertEqual(actual['server-delta/index.js'],'server')
        self.assertEqual(set(actual),{'Dockerfile','.dockerignore','dist-delta/index.html','server-delta/index.js'})
        self.assertNotEqual(actual['Dockerfile'],cleanup.context_expected({**m,'sourceCommit':'b'*40})['Dockerfile'])
    def test_context_cannot_escape_into_source_or_player_data(self):
        for name in ['../source/file','/data/player','assets/../../.env','assets//file']:
            with self.assertRaises(RuntimeError):cleanup.context_expected({'release':'tsu','sourceCommit':'a'*40,'delta':{name:'bad'},'serverDelta':{}})
if __name__=='__main__':unittest.main()
