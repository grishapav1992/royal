import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
class DeploymentGuards(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.root=Path(self.directory.name)
        self.scope=json.loads((HERE/'scope.json').read_text())
        containers={name:{'id':name+'-old','image':name+'-image','startedAt':'old','profile':{'envHash':'private-hash'}} for name in ['royal-game-1','royal-nile-play','royal-payments-1']}
        self.old={'source':{'src/shared/neopolisMath.ts':{'sha256':'old','lf':'old'}},'financeSource':{'src/shared/neopolisMath.ts':{'sha256':'old','lf':'old'}},'configuration':{'private.env':'unchanged'},'containers':containers,
          'financialProgram':{'play.js':'old-play','proof.js':'retained-proof'},'program':{'dist/index.html':'old-index','dist-server/index.js':'old-server','dist-server/payments.js':'retained-payment'},'preparedProgram':{'dist/index.html':'old-index','dist-server/index.js':'old-server','dist-server/payments.js':'retained-payment'},'preparedImage':containers['royal-game-1']['image'],'modules':{'old-module':'retained'},'hostContract':'old-host'}
        self.manifest={'release':self.scope['release'],'baseCommit':self.scope['base'],'sourceCommit':'a'*40,'before':self.old,'source':{'src/shared/neopolisMath.ts':'new'},'financeSource':{'src/shared/neopolisMath.ts':'new'},'backend':{'index.js':'new-server'},'modules':{'host-contracts.json':'new-host','studio-neopolis/active.json':'new-pointer'},'dist':{'index.html':'new-index'},'financial':'new-play','hostContract':'new-host'}
        (self.root/'install-manifest.json').write_text(json.dumps(self.manifest));(self.root/'scope.json').write_text(json.dumps(self.scope));shutil.copyfile(HERE/'deploy.py',self.root/'deploy.py')
        fake=types.ModuleType('snapshot');fake.snapshot=lambda:None;fake.inspect=lambda name:None;fake.profile=lambda row:None;fake.PROGRAM='reviewed inventory'
        gate=types.ModuleType('financial_gate');gate.FinancialGate=object
        with patch.dict(sys.modules,{'snapshot':fake,'financial_gate':gate}):
            spec=importlib.util.spec_from_file_location('neopolis_v4_deploy',self.root/'deploy.py');self.helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.helper)
        self.space=patch.object(self.helper.shutil,'disk_usage',return_value=types.SimpleNamespace(free=10*1024**3));self.space.start()
    def tearDown(self):self.space.stop();self.directory.cleanup()
    def test_scope_accepts_only_the_reviewed_game(self):
        self.helper.validate_scope(self.manifest,self.scope)
        for mutate in [lambda m:m['source'].update({'server/payments/index.ts':'other'}),lambda m:m['financeSource'].update({'server/finance/nile-play-ledger.ts':'other'}),lambda m:m['modules'].update({'other-game/active.json':'other'}),lambda m:m['backend'].update({'payments.js':'other'})]:
            changed=copy.deepcopy(self.manifest);mutate(changed)
            with self.assertRaises(AssertionError):self.helper.validate_scope(changed,self.scope)
    def test_private_and_parent_paths_cannot_enter_the_payload(self):
        for name in ['../source.ts','.env','src/../private','data/player.json','src/secrets/key']:
            with self.assertRaises(AssertionError):self.helper.plain(name)
    def test_only_neopolis_contract_may_advance(self):
        old={'games':{'studio-neopolis':{'apiVersion':1,'rulesVersion':3,'progressVersion':3},'other':{'apiVersion':1,'rulesVersion':1,'progressVersion':1}}}
        new=copy.deepcopy(old);new['games']['studio-neopolis']=self.scope['contract'];self.helper.check_contract(old,new)
        for changed in [old,{'games':{**new['games'],'unexpected':new['games']['other']}},{'games':{**new['games'],'other':self.scope['contract']}}]:
            with self.assertRaises(AssertionError):self.helper.check_contract(old,changed)
    def test_existing_services_sources_and_configuration_are_frozen(self):
        now={**copy.deepcopy(self.old),'freeBytes':10*1024**3};self.helper.stable(now)
        for mutate in [lambda s:s['configuration'].update({'private.env':'changed'}),lambda s:s['containers']['royal-payments-1'].update(id='replacement'),lambda s:s['containers']['royal-nile-play']['profile'].update(envHash='changed'),lambda s:s['source'].update({'other.ts':{'sha256':'new'}}),lambda s:s['program'].update({'dist-server/payments.js':'changed'}),lambda s:s['modules'].update({'other-module':'changed'})]:
            changed=copy.deepcopy(now);mutate(changed)
            with self.assertRaises(AssertionError):self.helper.stable(changed)
    def test_finance_phase_allows_only_reviewed_bundle_and_source(self):
        built={'game':'candidate-game','finance':'candidate-finance','program':{**self.old['program'],'dist/index.html':'new-index','dist-server/index.js':'new-server'}};(self.root/'build-result.json').write_text(json.dumps(built))
        now=copy.deepcopy(self.old);now['financeSource']['src/shared/neopolisMath.ts']={'sha256':'new','lf':'new'};now['financialProgram']['play.js']='new-play';now['containers']['royal-nile-play'].update(id='new-nile',image='candidate-finance',startedAt='new')
        self.helper.stable(now,finance=True)
        now['financialProgram']['proof.js']='unreviewed'
        with self.assertRaises(AssertionError):self.helper.stable(now,finance=True)
    def test_disk_reserve_is_never_lowered(self):
        with patch.object(self.helper.shutil,'disk_usage',return_value=types.SimpleNamespace(free=5*1024**3)):
            with self.assertRaises(AssertionError):self.helper.capacity()
    def test_public_module_directories_are_readable_and_private_umask_is_restored(self):
        previous=os.umask(0o077)
        try:
            target=self.root/'public-module'
            def install(args):target.mkdir(mode=0o755);(target/'media').mkdir();return {'published':True}
            self.assertTrue(self.helper.install_public_module(types.SimpleNamespace(run=install),None)['published'])
            self.assertEqual(target.stat().st_mode&0o777,0o755);self.assertEqual((target/'media').stat().st_mode&0o777,0o755)
            current=os.umask(0o077);self.assertEqual(current,0o077)
            with self.assertRaises(RuntimeError):self.helper.install_public_module(types.SimpleNamespace(run=lambda args:(_ for _ in ()).throw(RuntimeError('failed'))),None)
            current=os.umask(0o077);self.assertEqual(current,0o077)
        finally:os.umask(previous)

class SnapshotRaces(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('neopolis_snapshot',HERE/'snapshot.py');self.helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.helper)
    def test_finished_unknown_job_does_not_hide_persistent_services(self):
        missing=subprocess.CalledProcessError(1,['docker','inspect','oneoff'],stderr='Error: No such object: oneoff')
        with patch.object(self.helper,'run',return_value='royal-game-1\noneoff'),patch.object(self.helper,'inspect',side_effect=[{'Id':'retained'},missing]):
            self.assertEqual(self.helper.container_rows({'royal-game-1'}),{'royal-game-1':{'Id':'retained'}})
    def test_missing_protected_service_is_rejected(self):
        missing=subprocess.CalledProcessError(1,['docker','inspect','royal-game-1'],stderr='Error: No such object: royal-game-1')
        with patch.object(self.helper,'run',return_value='royal-game-1'),patch.object(self.helper,'inspect',side_effect=missing):
            with self.assertRaises(subprocess.CalledProcessError):self.helper.container_rows({'royal-game-1'})
    def test_daemon_or_permission_error_is_rejected(self):
        denied=subprocess.CalledProcessError(1,['docker','inspect','oneoff'],stderr='permission denied')
        with patch.object(self.helper,'run',return_value='oneoff'),patch.object(self.helper,'inspect',side_effect=denied):
            with self.assertRaises(subprocess.CalledProcessError):self.helper.container_rows({'royal-game-1'})

if __name__=='__main__':unittest.main()
