import copy
import importlib.util
import json
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
        self.old={'source':{'src/shared/forestHeartMath.ts':{'sha256':'old','lf':'old'}},'financeSource':{'src/shared/forestHeartMath.ts':{'sha256':'old','lf':'old'}},'configuration':{'private.env':'unchanged'},'containers':containers,
          'financialProgram':{'play.js':'old-play','proof.js':'retained-proof'},'program':{'dist/index.html':'old-index','dist-server/index.js':'old-server','dist-server/payments.js':'retained-payment'},'preparedProgram':{'dist/index.html':'old-index','dist-server/index.js':'old-server','dist-server/payments.js':'retained-payment'},'preparedImage':containers['royal-game-1']['image'],'modules':{'old-module':'retained'},'hostContract':'old-host'}
        self.manifest={'release':self.scope['release'],'baseCommit':self.scope['base'],'sourceCommit':'a'*40,'before':self.old,'source':{'src/shared/forestHeartMath.ts':'new'},'financeSource':{},'financialServiceRetained':True,'backend':{'index.js':'new-server'},'modules':{'host-contracts.json':'new-host','studio-forest-heart/active.json':'new-pointer'},'dist':{'index.html':'new-index'},'financial':'new-play','hostContract':'new-host'}
        (self.root/'install-manifest.json').write_text(json.dumps(self.manifest));(self.root/'scope.json').write_text(json.dumps(self.scope));shutil.copyfile(HERE/'deploy.py',self.root/'deploy.py')
        fake=types.ModuleType('snapshot');fake.snapshot=lambda:None;fake.inspect=lambda name:None;fake.profile=lambda row:None;fake.PROGRAM='reviewed inventory'
        gate=types.ModuleType('financial_gate');gate.FinancialGate=object
        with patch.dict(sys.modules,{'snapshot':fake,'financial_gate':gate,'fcntl':types.ModuleType('fcntl')}):
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
    def test_only_forest_heart_contract_may_be_added(self):
        old={'games':{'studio-neopolis':{'apiVersion':1,'rulesVersion':4,'progressVersion':4},'other':{'apiVersion':1,'rulesVersion':1,'progressVersion':1}}}
        new=copy.deepcopy(old);new['games']['studio-forest-heart']=self.scope['contract'];self.helper.check_contract(old,new)
        altered=copy.deepcopy(new);altered['games']['studio-neopolis']['rulesVersion']=3
        for changed in [old,{'games':{**new['games'],'studio-caribbean-treasures':self.scope['contract']}},altered]:
            with self.assertRaises(AssertionError):self.helper.check_contract(old,changed)
    def test_existing_services_sources_and_configuration_are_frozen(self):
        now={**copy.deepcopy(self.old),'freeBytes':10*1024**3};self.helper.stable(now)
        for mutate in [lambda s:s['configuration'].update({'private.env':'changed'}),lambda s:s['containers']['royal-payments-1'].update(id='replacement'),lambda s:s['containers']['royal-nile-play']['profile'].update(envHash='changed'),lambda s:s['source'].update({'other.ts':{'sha256':'new'}}),lambda s:s['program'].update({'dist-server/payments.js':'changed'}),lambda s:s['modules'].update({'other-module':'changed'})]:
            changed=copy.deepcopy(now);mutate(changed)
            with self.assertRaises(AssertionError):self.helper.stable(changed)
    def test_financial_service_cannot_be_replaced(self):
        now=copy.deepcopy(self.old)
        with self.assertRaises(AssertionError):self.helper.stable(now,finance=True)
        for mutate in [lambda s:s['containers']['royal-nile-play'].update(image='other'),lambda s:s['financialProgram'].update({'play.js':'other'})]:
            changed=copy.deepcopy(now);mutate(changed)
            with self.assertRaises(AssertionError):self.helper.stable(changed)
    def test_readiness_requires_three_consecutive_successes(self):
        values=iter([{'ok':True,'ready':True,'testOnly':True},{'ok':True,'ready':False,'testOnly':True}]+[{'ok':True,'ready':True,'testOnly':True}]*3)
        sleeps=[]
        result=self.helper.ready_samples(lambda:next(values),sleep=sleeps.append,clock=lambda:0)
        self.assertEqual(len(result),3);self.assertEqual(len(sleeps),4)
    def test_readiness_times_out_without_lowering_the_requirement(self):
        times=iter([0,0,601])
        with self.assertRaises(RuntimeError):self.helper.ready_samples(lambda:{'ready':False},sleep=lambda _:None,clock=lambda:next(times))
    def test_disk_reserve_is_never_lowered(self):
        with patch.object(self.helper.shutil,'disk_usage',return_value=types.SimpleNamespace(free=5*1024**3)):
            with self.assertRaises(AssertionError):self.helper.capacity()

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
