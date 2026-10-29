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
        self.old={'source':{'src/shared/jackieChan.ts':{'sha256':'old','lf':'old'}},'financeSource':{'src/shared/jackieChan.ts':{'sha256':'old','lf':'old'}},'configuration':{'private.env':'unchanged'},'containers':containers,
          'financialProgram':{'play.js':'old-play','proof.js':'retained-proof'},'program':{'dist/index.html':'old-index','dist-server/index.js':'old-server','dist-server/payments.js':'retained-payment'},'preparedProgram':{'dist/index.html':'old-index','dist-server/index.js':'old-server','dist-server/payments.js':'retained-payment'},'preparedImage':containers['royal-game-1']['image'],'modules':{'old-module':'retained'},'hostContract':'old-host'}
        self.manifest={'release':self.scope['release'],'baseCommit':self.scope['base'],'sourceCommit':'a'*40,'before':self.old,'source':{'src/shared/jackieChan.ts':'new'},'financeSource':{'src/shared/jackieChan.ts':'new'},'backend':{'index.js':'new-server'},'modules':{'host-contracts.json':'new-host','original-jackie-chan/active.json':'new-pointer'},'dist':{'index.html':'new-index'},'financial':'new-play','hostContract':'new-host'}
        (self.root/'install-manifest.json').write_text(json.dumps(self.manifest));(self.root/'scope.json').write_text(json.dumps(self.scope));shutil.copyfile(HERE/'deploy.py',self.root/'deploy.py')
        fake=types.ModuleType('snapshot');fake.snapshot=lambda:None;fake.inspect=lambda name:None;fake.profile=lambda row:None;fake.PROGRAM='reviewed inventory'
        gate=types.ModuleType('financial_gate');gate.FinancialGate=object
        modules={'snapshot':fake,'financial_gate':gate}
        if os.name=='nt':modules['fcntl']=types.ModuleType('fcntl')
        with patch.dict(sys.modules,modules):
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
    def test_only_jackie_contract_may_be_added(self):
        old={'games':{'studio-neopolis':{'apiVersion':1,'rulesVersion':4,'progressVersion':4},'other':{'apiVersion':1,'rulesVersion':2,'progressVersion':3}}}
        new=copy.deepcopy(old);new['games']['original-jackie-chan']=self.scope['contract'];self.helper.check_contract(old,new)
        for changed in [old,{'games':{**new['games'],'unexpected':new['games']['other']}},{'games':{**new['games'],'other':self.scope['contract']}}]:
            with self.assertRaises(AssertionError):self.helper.check_contract(old,changed)
    def test_image_runtime_compares_environment_values_and_all_service_fields(self):
        base={'Env':['A=1','B=2'],'Volumes':None,'ExposedPorts':{},'Cmd':['node','index.js'],'User':'node'}
        reordered={**base,'Env':['B=2','A=1'],'Volumes':{}}
        self.assertEqual(self.helper.image_runtime(base),self.helper.image_runtime(reordered))
        self.assertNotEqual(self.helper.image_runtime(base),self.helper.image_runtime({**base,'Env':['A=2','B=2']}))
        self.assertNotEqual(self.helper.image_runtime(base),self.helper.image_runtime({**base,'User':'root'}))
    def test_existing_services_sources_and_configuration_are_frozen(self):
        now={**copy.deepcopy(self.old),'freeBytes':10*1024**3};self.helper.stable(now)
        for mutate in [lambda s:s['configuration'].update({'private.env':'changed'}),lambda s:s['containers']['royal-payments-1'].update(id='replacement'),lambda s:s['containers']['royal-nile-play']['profile'].update(envHash='changed'),lambda s:s['source'].update({'other.ts':{'sha256':'new'}}),lambda s:s['program'].update({'dist-server/payments.js':'changed'}),lambda s:s['modules'].update({'other-module':'changed'})]:
            changed=copy.deepcopy(now);mutate(changed)
            with self.assertRaises(AssertionError):self.helper.stable(changed)
    def test_finance_phase_allows_only_reviewed_bundle_and_source(self):
        built={'game':'candidate-game','finance':'candidate-finance','program':{**self.old['program'],'dist/index.html':'new-index','dist-server/index.js':'new-server'}};(self.root/'build-result.json').write_text(json.dumps(built))
        now=copy.deepcopy(self.old);now['financeSource']['src/shared/jackieChan.ts']={'sha256':'new','lf':'new'};now['financialProgram']['play.js']='new-play';now['containers']['royal-nile-play'].update(id='new-nile',image='candidate-finance',startedAt='new')
        self.helper.stable(now,finance=True)
        now['financialProgram']['proof.js']='unreviewed'
        with self.assertRaises(AssertionError):self.helper.stable(now,finance=True)
    def test_transient_financial_readiness_requires_three_consecutive_successes(self):
        sample={'ready':True,'at':1}
        with patch.object(self.helper,'finance_health',side_effect=[AssertionError(),sample,sample,AssertionError(),sample,sample,sample]),patch.object(self.helper.time,'sleep'),patch.object(self.helper,'save') as save:
            self.assertEqual(self.helper.wait_finance_ready(),[sample,sample,sample])
            self.assertEqual(save.call_args.args[1]['consecutiveReady'],3)
            self.assertEqual(len(save.call_args.args[1]['attempts']),7)
    @unittest.skipIf(os.name=='nt','POSIX directory mode is verified on the production host')
    def test_module_directories_are_public_and_private_umask_is_restored(self):
        directory=self.root/'public-module'
        publisher=types.SimpleNamespace(run=lambda args:directory.mkdir(mode=0o755))
        previous=os.umask(0o077)
        try:
            self.helper.publish_module(publisher,None)
            self.assertEqual(directory.stat().st_mode&0o777,0o755)
            self.assertEqual(os.umask(0o077),0o077)
        finally:os.umask(previous)
    @unittest.skipIf(os.name=='nt','POSIX umask is verified on the production host')
    def test_failed_module_publication_restores_private_umask(self):
        def fail(args):raise RuntimeError('injected')
        previous=os.umask(0o077)
        try:
            with self.assertRaises(RuntimeError):self.helper.publish_module(types.SimpleNamespace(run=fail),None)
            self.assertEqual(os.umask(0o077),0o077)
        finally:os.umask(previous)
    def test_disk_reserve_is_never_lowered(self):
        with patch.object(self.helper.shutil,'disk_usage',return_value=types.SimpleNamespace(free=5*1024**3)):
            with self.assertRaises(AssertionError):self.helper.capacity()
    def test_composite_backup_covers_changed_and_added_current_files(self):
        self.helper.M['backupBase']={'source':copy.deepcopy(self.old['source'])}
        self.helper.OLD['source']['src/shared/jackieChan.ts']={'sha256':'changed','lf':'changed'}
        self.helper.OLD['source']['new.ts']={'sha256':'added','lf':'added'}
        baseline,delta=self.helper.composite_rows('source')
        self.assertEqual(baseline,{'src/shared/jackieChan.ts':'old'})
        self.assertEqual(delta,{'src/shared/jackieChan.ts':'changed','new.ts':'added'})
        del self.helper.OLD['source']['src/shared/jackieChan.ts']
        with self.assertRaises(AssertionError):self.helper.composite_rows('source')

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
