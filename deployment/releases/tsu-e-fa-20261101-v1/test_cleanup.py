import importlib.util,sys,types,unittest
from pathlib import Path
if sys.platform=='win32':sys.modules.setdefault('fcntl',types.SimpleNamespace())
spec=importlib.util.spec_from_file_location('tsu_cleanup',Path(__file__).with_name('cleanup.py'))
cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)
class CleanupBoundary(unittest.TestCase):
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
