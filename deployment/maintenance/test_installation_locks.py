import contextlib, importlib.util, io, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('jackie_installer_locks',Path(__file__).with_name('install-retention.py'))
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)

@unittest.skipIf(sys.platform=='win32','Real flock checks require Linux')
class PublicationLocks(unittest.TestCase):
    def setUp(self):
        import fcntl
        self.fcntl=fcntl;self.temp=tempfile.TemporaryDirectory(prefix='royal-jackie-lock-test-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.paths=[str(self.root/n) for n in ['app.lock','client.lock','module.lock']]
        for name in self.paths:Path(name).touch()
        p=patch.object(deploy,'LOCKS',self.paths);p.start();self.addCleanup(p.stop)
        self.package=self.root/'prepared.bin';self.package.write_bytes(b'verified-package')

    def available(self, paths=None):
        for name in self.paths if paths is None else paths:
            with open(name,'a') as handle:self.fcntl.flock(handle,self.fcntl.LOCK_EX|self.fcntl.LOCK_NB)

    def test_critical_section_holds_all_locks_and_releases_them(self):
        with deploy.publication_locks():
            for name in self.paths:
                with open(name,'a') as handle,self.assertRaises(BlockingIOError):self.fcntl.flock(handle,self.fcntl.LOCK_EX|self.fcntl.LOCK_NB)
        self.available()

    def test_contention_releases_every_partial_lock_and_keeps_the_package(self):
        for index in [1,2]:
            with self.subTest(index=index),open(self.paths[index],'a') as blocker:
                self.fcntl.flock(blocker,self.fcntl.LOCK_EX|self.fcntl.LOCK_NB)
                with self.assertRaises(deploy.PublicationBusy):
                    with deploy.publication_locks():self.fail('Busy publisher entered installation')
                self.available([n for i,n in enumerate(self.paths) if i!=index])
                self.assertEqual(self.package.read_bytes(),b'verified-package')

    def test_failed_installation_releases_all_locks(self):
        with self.assertRaisesRegex(RuntimeError,'failed'):
            with deploy.publication_locks():raise RuntimeError('failed')
        self.available()

    def test_symlink_rejection_releases_an_earlier_lock(self):
        alias=self.root/'alias';alias.symlink_to(self.paths[1])
        with patch.object(deploy,'LOCKS',[self.paths[0],str(alias)]),self.assertRaisesRegex(RuntimeError,'Unsafe'):
            with deploy.publication_locks():self.fail('Symlink was accepted')
        self.available()

    def test_busy_command_returns_75_without_running_installation(self):
        action=Mock();output=io.StringIO()
        with open(self.paths[1],'a') as blocker:
            self.fcntl.flock(blocker,self.fcntl.LOCK_EX|self.fcntl.LOCK_NB)
            with contextlib.redirect_stdout(output):self.assertEqual(deploy.guarded_publication(action),75)
            action.assert_not_called();self.available([self.paths[0],self.paths[2]])
        report=json.loads(output.getvalue());self.assertFalse(report['publicationLocksHeld']);self.assertTrue(report['preparedPackagePreserved'])
        self.assertEqual(self.package.read_bytes(),b'verified-package')

    def test_success_runs_once(self):
        action=Mock(return_value=0);self.assertEqual(deploy.guarded_publication(action),0);action.assert_called_once();self.available()

