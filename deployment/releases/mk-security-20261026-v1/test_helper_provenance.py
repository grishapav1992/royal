import ast
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


class HelperSource(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.origin, self.stage = root/'origin.git', root/'stage'
        self.stage.mkdir()
        subprocess.run(['git','init','--bare',str(self.origin)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        self.git('init','-b','main')
        self.git('remote','add','origin',str(self.origin))
        self.git('commit','--allow-empty','-m','application')
        self.application = self.git('rev-parse','HEAD')
        self.git('push','origin','HEAD:main')
        self.git('switch','-c','publisher')
        self.git('commit','--allow-empty','-m','publisher')
        self.publisher = self.git('rev-parse','HEAD')
        self.git('switch','--detach',self.application)
        tree = ast.parse(Path(__file__).with_name('prepare.py').read_text())
        node = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name == 'helper_revision')
        namespace = {'re':re,'subprocess':subprocess}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'prepare.py','exec'),namespace)
        self.verify = namespace['helper_revision']

    def git(self,*args):
        return subprocess.check_output(['git','-c','user.name=Publisher tests','-c','user.email=fixture@example.invalid',
            '-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',*args],cwd=self.stage,
            text=True,stderr=subprocess.DEVNULL).strip()

    def test_unpublished_helper_is_rejected_then_fresh_fetch_accepts_the_integrated_commit(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify(self.stage,self.application,self.publisher)
        self.git('push','origin','publisher:main')
        self.assertEqual(self.verify(self.stage,self.application,self.publisher),self.publisher)
        self.assertEqual(self.git('rev-parse','HEAD'),self.application)
        self.assertEqual(self.git('status','--porcelain'),'')

    def test_application_source_must_also_be_in_main(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify(self.stage,self.publisher,self.application)

    def test_ambiguous_helper_reference_is_rejected(self):
        with self.assertRaisesRegex(AssertionError,'Full helper commit'):
            self.verify(self.stage,self.application,'publisher')


if __name__ == '__main__':
    unittest.main()
