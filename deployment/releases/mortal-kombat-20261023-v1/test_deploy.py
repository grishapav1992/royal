"""Publisher guards and rollback behavior with no server or database access."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import types
import unittest

HERE=Path(__file__).resolve().parent
TASK=HERE.parents[2]/'artifacts/work/mortal-kombat-duel'

class PublisherTests(unittest.TestCase):
 def setUp(self):
  TASK.mkdir(parents=True,exist_ok=True)
  self.folder=Path(tempfile.mkdtemp(prefix='publisher-test-',dir=TASK))
  shutil.copyfile(HERE/'deploy.py',self.folder/'deploy.py')
  (self.folder/'install-manifest.json').write_text(json.dumps({'before':{},'release':'test'}))
  fake=types.ModuleType('snapshot');fake.snapshot=lambda:{};fake.inspect=lambda name:{};fake.profile=lambda row:row
  self.saved=sys.modules.get('snapshot');sys.modules['snapshot']=fake
  spec=importlib.util.spec_from_file_location('combat_release_test',self.folder/'deploy.py');self.r=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.r)
  r=self.r;r.LIVE=self.folder/'live';r.LIVE.mkdir();r.HOST=self.folder/'host.json';r.HOST.write_text('old contract');r.BACKUP=self.folder/'backup';r.BACKUP.mkdir()
  self.sha=lambda b:hashlib.sha256(b).hexdigest()
  r.OLD={'source':{'server/old.ts':self.sha(b'old')},'hostContract':self.sha(b'old contract'),'modules':{},'preparedImage':'old-image','containers':{'royal-game-1':{'image':'old-image','composeFiles':['compose.yaml']}}}
  r.M={'source':{'server/old.ts':self.sha(b'new'),'server/new.ts':self.sha(b'added')},'pointers':{},'payload':{'host.json':self.sha(b'new contract')}}
  (r.LIVE/'server').mkdir();(r.LIVE/'server/old.ts').write_bytes(b'new');(r.LIVE/'server/new.ts').write_bytes(b'added');r.HOST.write_text('new contract');(r.BACKUP/'host.json').write_text('old contract')
  old=self.folder/'old.ts';old.write_bytes(b'old')
  with tarfile.open(r.BACKUP/'source.tgz','w:gz')as archive:archive.add(old,arcname='server/old.ts')
  r.inspect=lambda name:{'Image':'new-image'}
  self.commands=[];r.run=lambda command,**kwargs:self.commands.append(command)or'';r.wait_health=lambda *args:None
 def tearDown(self):
  if self.saved is None:sys.modules.pop('snapshot',None)
  else:sys.modules['snapshot']=self.saved
  shutil.rmtree(self.folder)
 def test_rollback_restores_source_and_host_without_restoring_money(self):
  r=self.r;r.rollback_host({'game':'new-image'})
  self.assertEqual((r.LIVE/'server/old.ts').read_bytes(),b'old');self.assertFalse((r.LIVE/'server/new.ts').exists());self.assertEqual(r.HOST.read_text(),'old contract')
  self.assertFalse(any('pg_restore'in command or 'nile-play'in command for command in self.commands))
  self.assertFalse(json.loads((r.ROOT/'rollback.json').read_text())['databaseRestored'])
 def test_later_source_edit_blocks_rollback_before_writes(self):
  r=self.r;(r.LIVE/'server/old.ts').write_text('other task')
  with self.assertRaisesRegex(AssertionError,'Later source'):r.rollback_host({'game':'new-image'})
  self.assertEqual((r.LIVE/'server/old.ts').read_text(),'other task');self.assertFalse(self.commands)
 def test_later_runtime_blocks_rollback_before_writes(self):
  r=self.r;r.inspect=lambda name:{'Image':'another-release'}
  with self.assertRaisesRegex(AssertionError,'Later host'):r.rollback_host({'game':'new-image'})
  self.assertEqual((r.LIVE/'server/old.ts').read_bytes(),b'new');self.assertFalse(self.commands)
 def test_later_contract_blocks_rollback_before_writes(self):
  r=self.r;r.HOST.write_text('other task')
  with self.assertRaisesRegex(AssertionError,'Later host contract'):r.rollback_host({'game':'new-image'})
  self.assertEqual((r.LIVE/'server/old.ts').read_bytes(),b'new')
 def test_payload_tampering_blocks_before_server_inspection(self):
  r=self.r;f=r.ROOT/'play.js';f.write_text('tampered');r.M={'payload':{'play.js':self.sha(b'expected')}}
  with self.assertRaises(AssertionError):r.guard()

if __name__=='__main__':unittest.main()
