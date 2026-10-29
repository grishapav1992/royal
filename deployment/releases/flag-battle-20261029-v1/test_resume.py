import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('flag_resume',Path(__file__).with_name('resume.py'))
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)

class ResumeGuards(unittest.TestCase):
    def test_three_successes_must_be_consecutive(self):
        rows=iter([True,False,True,True,True]);calls=[];now=[0]
        def health():
            good=next(rows);calls.append(good)
            if not good:raise subprocess.CalledProcessError(1,['health'])
            return {'ok':True,'ready':True,'testOnly':True}
        result=helper.ready_samples(health,sleep=lambda seconds:now.__setitem__(0,now[0]+seconds),clock=lambda:now[0])
        self.assertEqual(len(result),3);self.assertEqual(len(calls),5)
    def test_timeout_cannot_turn_into_approval(self):
        now=[0]
        with self.assertRaises(RuntimeError):helper.ready_samples(lambda:{'ok':True,'ready':False,'testOnly':True},sleep=lambda seconds:now.__setitem__(0,now[0]+seconds),clock=lambda:now[0],timeout=30)
    def test_resume_rejects_wrong_phase_commit_and_any_later_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            def write(name,row):(root/name).write_text(json.dumps(row))
            write('failure.json',{'phase':'finance'});write('exit.json',{'exitCode':1,'sourceCommit':'a'*40});write('install-manifest.json',{'sourceCommit':'a'*40})
            helper.prior_failure(root)
            write('failure.json',{'phase':'host'})
            with self.assertRaises(AssertionError):helper.prior_failure(root)
            write('failure.json',{'phase':'finance'});write('exit.json',{'exitCode':1,'sourceCommit':'b'*40})
            with self.assertRaises(AssertionError):helper.prior_failure(root)
            write('exit.json',{'exitCode':1,'sourceCommit':'a'*40});write('finance-published.json',{})
            with self.assertRaises(AssertionError):helper.prior_failure(root)

if __name__=='__main__':unittest.main()
