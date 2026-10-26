import ast
import base64
import copy
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile
import unittest

CODE = Path(__file__).with_name('deploy.py').read_text()


def functions(names, **values):
    tree = ast.parse(CODE)
    namespace = dict(Path=Path, PurePosixPath=PurePosixPath, base64=base64, hashlib=hashlib, json=json, re=re, tarfile=tarfile, **values)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            exec(compile(ast.Module(body=[node],type_ignores=[]),'deploy.py','exec'),namespace)
    return namespace


class SecurityRelease(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)/'mk-security-20261026-v1'; self.root.mkdir()
        self.n = functions(['require','sha','inventory','safe_name','lock_transition','package_transition','git_tree','verify_helper_source','payload','expected_program','verify_tar','bounded_archive'],
            ROOT=self.root, NAME=self.root.name, DIGEST=re.compile(r'[a-f0-9]{64}'))
        self.n['Path'] = lambda value: self.root.parent if value == '/opt/royal-releases' else Path(value)
        old = {'lockfileVersion':3,'packages':{'':{'name':'royal'},'node_modules/body-parser':{'version':'2.3.0'},'node_modules/qs':{'version':'6.16.0'},'node_modules/pg':{'version':'8.23.1'}}}
        new = copy.deepcopy(old); new['packages']['node_modules/body-parser']['version']='2.4.0'; new['packages']['node_modules/qs']['version']='6.16.1'
        self.old, self.new = old, new
        def write(name, content):
            path=self.root/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_text(content)
            return self.n['sha'](path)
        old_hash=write('old-lock.json',json.dumps(old)); lock_hash=write('source/package-lock.json',json.dumps(new))
        write('metadata/package-lock.json',json.dumps(new)); write('source/server/activities.ts','public view')
        old_package={'name':'royal','scripts':{'test:rtp-gate':'node --test server-tests/rtp-gate.test.mjs'},'dependencies':{'pg':'8'}}
        new_package=copy.deepcopy(old_package);new_package['scripts']['test:rtp-gate']='node --test server-tests/rtp-gate.test.mjs server-tests/cosmic-rtp-gate.test.mjs'
        self.old_package,self.new_package=old_package,new_package
        old_package_hash=write('old-package.json',json.dumps(old_package));package_hash=write('source/package.json',json.dumps(new_package))
        write('metadata/package.json',json.dumps(new_package))
        write('server-delta/index.js','new backend'); (self.root/'dist-delta').mkdir()
        for package,version in [('body-parser','2.4.0'),('qs','6.16.1')]: write('dependency-delta/'+package+'/package.json',json.dumps({'version':version}))
        write('dependency-delta/.package-lock.json',json.dumps(new))
        helpers={name:write(name,'reviewed '+name) for name in ['deploy.py','snapshot.py','runtime-inventory.cjs','quiesce.cjs','verify-runtime.cjs','modules.py','financial_gate.py']}
        source={name:'a'*64 for name in ['server/combatGame.ts','server/combatRoom.ts','server/combatGuard.ts','server/commonCombatWallet.ts',
            'server/pvp/virtual-wallet.ts','server/finance/combat-escrow.ts','server/finance/pvp-money.ts','src/shared/combat.ts','src/shared/combatEscrow.ts','src/shared/pvp.ts']}
        source['server/payments/index.ts']='a'*64;source['package.json']=old_package_hash
        before={'source':source,'sourceLF':{'package-lock.json':old_hash,'package.json':old_package_hash,'server/payments/index.ts':'a'*64},'dependencyLock':old,
            'program':{'dist-server/payments.js':'f'*64,'dist-server/crypto-reconcile.js':'e'*64,'node_modules/body-parser/package.json':'b'*64,'node_modules/qs/package.json':'c'*64,'node_modules/pg/index.js':'d'*64},
            'moduleFiles':{},'moduleHost':{'games':{game:{'apiVersion':1,'rulesVersion':2,'progressVersion':1} for game in ['mortal-kombat','studio-cosmic-escape']}}}
        manifest={'release':self.root.name,'sourceCommit':'e'*40,'helpers':helpers,'before':before,
            'changed':self.n['inventory'](self.root/'source'),'delta':{},'serverDelta':self.n['inventory'](self.root/'server-delta'),
            'runtimePackages':{'package-lock.json':lock_hash,'package.json':package_hash},'dependencyFiles':self.n['inventory'](self.root/'dependency-delta')}
        def git_object(kind,data):return hashlib.sha1((kind+' '+str(len(data))).encode()+b'\0'+data).hexdigest()
        helper_tree=b''
        for name in sorted(helpers):
            oid=git_object('blob',(self.root/name).read_bytes())
            helper_tree+=b'100644 '+name.encode()+b'\0'+bytes.fromhex(oid)
        trees={git_object('tree',helper_tree):base64.b64encode(helper_tree).decode()};tree_id=git_object('tree',helper_tree)
        for name in [self.root.name,'releases','deployment']:
            data=b'40000 '+name.encode()+b'\0'+bytes.fromhex(tree_id);tree_id=git_object('tree',data)
            trees[tree_id]=base64.b64encode(data).decode()
        commit=('tree '+tree_id+'\nauthor Fixture <fixture@example.com> 0 +0000\ncommitter Fixture <fixture@example.com> 0 +0000\n\nfixture\n').encode()
        helper_commit=git_object('commit',commit)
        helper_proof={'sourceCommit':helper_commit,'applicationSourceCommit':manifest['sourceCommit'],'originMain':'f'*40,
            'files':helpers,'commit':base64.b64encode(commit).decode(),'trees':trees}
        manifest.update(helperSourceCommit=helper_commit,helperProofSha256=write('helpers-source.json',json.dumps(helper_proof)))
        manifest['preservedBackend']={name:{'runtimeSha256':before['program']['dist-server/'+name],'sourceInputs':{'server/payments/index.ts':'a'*64}} for name in ['payments.js','crypto-reconcile.js']}
        packages=[]
        for index,game in enumerate(['mortal-kombat','studio-cosmic-escape']):
            version='1.0.0-'+str(index+1)*12;prefix='modules/'+game+'/versions/'+version+'/'
            js='export{};';css='body{}';jh=hashlib.sha256(js.encode()).hexdigest();ch=hashlib.sha256(css.encode()).hexdigest()
            entry='entry-'+jh[:16]+'.js';style='style-'+ch[:16]+'.css'
            write(prefix+entry,js);write(prefix+style,css)
            write(prefix+'manifest.json',json.dumps({'format':1,'gameId':game,'version':version,'apiVersion':1,'rulesVersion':2,'progressVersion':1,'sourceSha256':'f'*64,'entry':entry,'styles':[style],'files':{entry:jh,style:ch}}))
            packages.append({'gameId':game,'version':version,'beforeSha256':'none'})
        manifest.update(moduleDelta=self.n['inventory'](self.root/'modules'),modulePackages=packages)
        self.n.update(M=manifest,OLD=before,BASE=source,CHANGES=manifest['changed'],DELTA={},SERVER_DELTA=manifest['serverDelta'])

    def test_changed_retained_backend_input_is_rejected(self):
        self.n['CHANGES']['server/payments/index.ts']='0'*64
        with self.assertRaises(RuntimeError):self.n['payload']()

    def test_helper_update_cannot_change_the_application_source_envelope(self):
        self.n['M']['helperSourceCommit']='c'*40
        with self.assertRaisesRegex(RuntimeError,'helper source'):self.n['payload']()

    def test_modified_helper_proof_is_rejected(self):
        (self.root/'helpers-source.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError,'helper provenance'):self.n['payload']()

    def test_ignored_bytecode_is_refused_before_any_source_publication(self):
        name='scripts/__pycache__/game-module-release.cpython-312.pyc'
        path=self.root/'source'/name;path.parent.mkdir(parents=True);path.write_bytes(b'generated cache')
        self.n['CHANGES'][name]=self.n['sha'](path)
        with self.assertRaisesRegex(RuntimeError,'Generated or unobservable source'):self.n['payload']()

    def test_recomputed_hashes_cannot_mix_another_helper_into_the_pinned_git_commit(self):
        (self.root/'deploy.py').write_text('unreviewed replacement')
        self.n['M']['helpers']['deploy.py']=self.n['sha'](self.root/'deploy.py')
        proof=json.loads((self.root/'helpers-source.json').read_text());proof['files']=self.n['M']['helpers']
        (self.root/'helpers-source.json').write_text(json.dumps(proof))
        self.n['M']['helperProofSha256']=self.n['sha'](self.root/'helpers-source.json')
        with self.assertRaisesRegex(RuntimeError,'pinned Git source'):self.n['payload']()

    def test_recomputed_metadata_cannot_relabel_another_git_commit(self):
        self.n['M']['helperSourceCommit']='c'*40
        proof=json.loads((self.root/'helpers-source.json').read_text());proof['sourceCommit']='c'*40
        (self.root/'helpers-source.json').write_text(json.dumps(proof))
        self.n['M']['helperProofSha256']=self.n['sha'](self.root/'helpers-source.json')
        with self.assertRaisesRegex(RuntimeError,'pinned revision'):self.n['payload']()
    def test_retained_backend_hash_is_protected(self):
        self.n['M']['preservedBackend']['payments.js']['runtimeSha256']='0'*64
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_preparer_checks_each_transitive_backend_source(self):
        tree=ast.parse(Path(__file__).with_name('prepare.py').read_text())
        n={'Path':Path,'lf':lambda path:hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()}
        function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='preserved_inputs')
        exec(compile(ast.Module(body=[function],type_ignores=[]),'prepare.py','exec'),n)
        p=self.root/'server/example.ts';p.parent.mkdir();p.write_text('source')
        baseline={'sourceLF':{'server/example.ts':n['lf'](p)}}
        self.assertTrue(n['preserved_inputs'](self.root,baseline,['server/example.ts']))
        p.write_text('changed')
        with self.assertRaises(AssertionError):n['preserved_inputs'](self.root,baseline,['server/example.ts'])
    def test_only_approved_rtp_script_changes(self):self.n['package_transition'](self.old_package,self.new_package)
    def test_unreviewed_package_dependency_is_rejected(self):
        value=copy.deepcopy(self.new_package);value['dependencies']['pg']='9'
        with self.assertRaises(RuntimeError):self.n['package_transition'](self.old_package,value)
    def test_unreviewed_package_script_is_rejected(self):
        value=copy.deepcopy(self.new_package);value['scripts']['postinstall']='unexpected'
        with self.assertRaises(RuntimeError):self.n['package_transition'](self.old_package,value)
    def test_unreviewed_third_module_is_rejected(self):
        (self.root/'modules/other').mkdir();(self.root/'modules/other/extra.js').write_text('extra')
        self.n['M']['moduleDelta']=self.n['inventory'](self.root/'modules')
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_pointer_baseline_change_is_rejected(self):
        self.n['M']['modulePackages'][0]['beforeSha256']='0'*64
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_retained_backup_does_not_allocate_a_second_archive(self):
        n=functions(['require','backup_budget'],DISK_RESERVE=500,BUILD_MARGIN=50,WALLET_BACKUP_LIMIT=2*1024**2)
        self.assertIsNone(n['backup_budget'](600,10,True))
        with self.assertRaises(RuntimeError):n['backup_budget'](600,10,False)
    def test_retained_backup_keeps_the_complete_runtime_reserve(self):
        n=functions(['require','backup_budget'],DISK_RESERVE=500,BUILD_MARGIN=50,WALLET_BACKUP_LIMIT=2*1024**2)
        with self.assertRaises(RuntimeError):n['backup_budget'](589,10,True)
    def test_valid_backend_only_payload(self): self.n['payload']()
    def test_only_reviewed_lock_packages_change(self): self.n['lock_transition'](self.old,self.new)
    def test_unrelated_dependency_is_rejected(self):
        value=copy.deepcopy(self.new); value['packages']['node_modules/pg']['version']='9'
        with self.assertRaises(RuntimeError): self.n['lock_transition'](self.old,value)
    def test_root_metadata_change_is_rejected(self):
        value=copy.deepcopy(self.new);value['lockfileVersion']=2
        with self.assertRaises(RuntimeError):self.n['lock_transition'](self.old,value)
    def test_inventory_addition_is_rejected(self):
        value=copy.deepcopy(self.new);value['packages']['node_modules/new']={}
        with self.assertRaises(RuntimeError):self.n['lock_transition'](self.old,value)
    def test_wrong_patched_version_is_rejected(self):
        value=copy.deepcopy(self.new);value['packages']['node_modules/body-parser']['version']='2.3.0'
        with self.assertRaises(RuntimeError):self.n['lock_transition'](self.old,value)
    def test_changed_helper_is_rejected(self):
        (self.root/'quiesce.cjs').write_text('changed')
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_changed_backend_is_rejected(self):
        (self.root/'server-delta/index.js').write_text('changed')
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_changed_dependency_is_rejected(self):
        (self.root/'dependency-delta/qs/package.json').write_text('{}')
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_financial_rule_change_is_rejected(self):
        self.n['CHANGES']['server/combatRoom.ts']='f'*64
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_extra_dependency_replacement_is_rejected(self):
        (self.root/'dependency-delta/pg').mkdir();(self.root/'dependency-delta/pg/index.js').write_text('changed')
        self.n['M']['dependencyFiles']=self.n['inventory'](self.root/'dependency-delta')
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_obsolete_dependency_file_is_rejected(self):
        self.n['OLD']['program']['node_modules/body-parser/obsolete.js']='f'*64
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_incompatible_rollback_contract_is_rejected(self):
        self.n['OLD']['moduleHost']['games']['mortal-kombat']['rulesVersion']=1
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_expected_runtime_preserves_other_dependencies(self):
        self.assertEqual(self.n['expected_program']()['node_modules/pg/index.js'],'d'*64)
    def test_payload_symlink_is_rejected(self):
        (self.root/'dependency-delta/qs/link').symlink_to('../body-parser/package.json')
        with self.assertRaises(RuntimeError):self.n['payload']()
    def test_unsafe_source_path_is_rejected(self):
        for value in ['../file','/root/key','.env','src/../.env','src/secrets/key','src/node_modules/file']:
            with self.subTest(value=value),self.assertRaises(RuntimeError):self.n['safe_name'](value)
    def test_streamed_archive_is_complete(self):
        live=self.root/'live';live.mkdir();(live/'source.ts').write_text('source')
        self.n.update(LIVE=live,OLD={'source':{'source.ts':self.n['sha'](live/'source.ts')}})
        archive=self.root/'source.tgz';self.n['bounded_archive'](archive,4096);self.n['verify_tar'](archive)
    def test_archive_limit_removes_partial_output(self):
        live=self.root/'live';live.mkdir();(live/'source.ts').write_text('source')
        self.n.update(LIVE=live,OLD={'source':{'source.ts':self.n['sha'](live/'source.ts')}})
        archive=self.root/'source.tgz'
        with self.assertRaises(RuntimeError):self.n['bounded_archive'](archive,1)
        self.assertFalse(archive.exists())
    def test_changed_source_during_backup_removes_partial_output(self):
        live=self.root/'live';live.mkdir();(live/'source.ts').write_text('changed')
        self.n.update(LIVE=live,OLD={'source':{'source.ts':'0'*64}})
        archive=self.root/'source.tgz'
        with self.assertRaises(RuntimeError):self.n['bounded_archive'](archive,4096)
        self.assertFalse(archive.exists())
    def test_busy_gate_never_starts_rollback_or_source_mutation(self):
        calls=[];built={'program':{},'image':'candidate'};(self.root/'build-result.json').write_text(json.dumps(built))
        n=functions(['require','publish'],ROOT=self.root,NAME=self.root.name,M={},payload=lambda:None,baseline=lambda:None,
            expected_program=lambda:{},image=lambda ref:'candidate',quiet_gate=lambda:(_ for _ in ()).throw(RuntimeError('busy')),
            publication_backup=lambda value:None,publication_capacity=lambda:None,
            rollback=lambda:calls.append('rollback'),atomic=lambda *args:calls.append('source'))
        with self.assertRaisesRegex(RuntimeError,'busy'):n['publish']()
        self.assertEqual(calls,[])

    def test_disk_loss_after_baseline_never_opens_the_financial_gate(self):
        calls=[];built={'program':{},'image':'candidate'};(self.root/'build-result.json').write_text(json.dumps(built))
        def capacity():raise RuntimeError('publication reserve')
        n=functions(['require','publish'],ROOT=self.root,NAME=self.root.name,M={},payload=lambda:None,baseline=lambda:None,
            expected_program=lambda:{},image=lambda ref:'candidate',publication_backup=lambda value:None,
            publication_capacity=capacity,quiet_gate=lambda:calls.append('gate'),rollback=lambda:calls.append('rollback'))
        with self.assertRaisesRegex(RuntimeError,'publication reserve'):n['publish']()
        self.assertEqual(calls,[])

    def publication_fixture(self):
        import types
        calls=[];built={'program':{},'image':'candidate'};(self.root/'build-result.json').write_text(json.dumps(built))
        class Gate:
            def confirm(self):calls.append('confirm')
            def check(self):pass
            def run(self,*args,**kwargs):raise RuntimeError('Docker client interrupted')
            def release(self):calls.append('release')
            def close(self):calls.append('close')
        n=functions(['require','publish'],ROOT=self.root,LIVE=self.root,NAME=self.root.name,
            M={'sourceCommit':'revision'},CHANGES={'code':'a'*64},DELTA={},payload=lambda:None,baseline=lambda:None,
            expected_program=lambda:{},image=lambda ref:'candidate',publication_backup=lambda value:None,
            publication_capacity=lambda:None,quiet_gate=lambda:Gate(),rollback=lambda:calls.append('rollback'),
            atomic=lambda *args:calls.append('source'),reconcile_game=lambda value:calls.append('observe'),
            write=lambda name,value:calls.append((name,value)),
            signal=types.SimpleNamespace(SIGTERM=15,SIGHUP=1,SIGINT=2,SIG_IGN=0,signal=lambda *args:None))
        return n,calls

    def test_interrupted_docker_command_defers_second_compose_even_without_error_attributes(self):
        n,calls=self.publication_fixture()
        with self.assertRaisesRegex(RuntimeError,'Docker client interrupted'):n['publish']()
        self.assertNotIn('rollback',calls)
        self.assertIn('observe',calls)
        receipts={x[0]:x[1] for x in calls if isinstance(x,tuple)}
        self.assertTrue(receipts['publication-failed.json']['daemonOutcomeUnknown'])
        self.assertTrue(receipts['recovery-required.json']['automaticSecondComposeRefused'])

    def test_disk_loss_while_draining_causes_no_source_mutation_or_recovery_mutation(self):
        n,calls=self.publication_fixture();attempts=[]
        def capacity():
            attempts.append(1)
            if len(attempts)>1:raise RuntimeError('disk fell while draining')
        n['publication_capacity']=capacity
        with self.assertRaisesRegex(RuntimeError,'disk fell while draining'):n['publish']()
        self.assertNotIn('source',calls);self.assertNotIn('rollback',calls);self.assertIn('close',calls)

    def test_publication_reserve_includes_pending_modules_and_source_replacement(self):
        import types
        (self.root/'source/code').write_bytes(b'abc')
        (self.root/'modules/package').write_bytes(b'payload')
        n=functions(['require','publication_min_free','publication_capacity'],ROOT=self.root,LIVE=self.root,
            CHANGES={'code':'a'*64},M={'moduleDelta':{'package':'b'*64}},DISK_RESERVE=500,BUILD_MARGIN=50,
            shutil=types.SimpleNamespace(disk_usage=lambda path:types.SimpleNamespace(free=577)))
        self.assertEqual(n['publication_min_free'](),577)
        with self.assertRaisesRegex(RuntimeError,'publication reserve'):n['publication_capacity']()
        n['shutil'].disk_usage=lambda path:types.SimpleNamespace(free=578)
        self.assertEqual(n['publication_capacity'](),577)

    def reconciliation_fixture(self):
        n=functions(['require','settled_game'],OLD={'container':{'image':'old','host':{'NetworkMode':'royal_default'}}})
        row={'Id':'one','Name':'/royal-game-1','Image':'old','Config':{'Labels':{'com.docker.compose.project':'royal',
             'com.docker.compose.service':'game','com.docker.compose.oneoff':'False'}},
             'State':{'Status':'running','Health':{'Status':'healthy'},'StartedAt':'now'}}
        return n,row,{'image':'reviewed'}

    def test_ambiguous_replacement_is_refused_before_another_compose(self):
        n,row,built=self.reconciliation_fixture();temporary=copy.deepcopy(row);temporary['Name']='/one_royal-game-1'
        with self.assertRaisesRegex(RuntimeError,'duplicate game'):n['settled_game']([row,temporary],built)
        with self.assertRaisesRegex(RuntimeError,'Temporary replacement'):n['settled_game']([temporary],built)

    def test_unknown_or_restarting_runtime_requires_reconciliation(self):
        n,row,built=self.reconciliation_fixture();row['Image']='foreign'
        with self.assertRaisesRegex(RuntimeError,'Unreviewed'):n['settled_game']([row],built)
        row['Image']='reviewed';row['State']['Status']='restarting'
        with self.assertRaisesRegex(RuntimeError,'not settled'):n['settled_game']([row],built)

    def test_known_completed_candidate_can_be_repaired_when_unhealthy(self):
        n,row,built=self.reconciliation_fixture();row['Image']='reviewed';row['State']['Health']['Status']='unhealthy'
        self.assertEqual(n['settled_game']([row],built)['image'],'reviewed')

    def test_reconciliation_accepts_only_known_healthy_game_and_ignores_gate_oneoff(self):
        n,row,built=self.reconciliation_fixture();oneoff=copy.deepcopy(row)
        oneoff['Config']['Labels']['com.docker.compose.oneoff']='True';oneoff['Name']='/royal-game-run-gate'
        self.assertEqual(n['settled_game']([row,oneoff],built)['id'],'one')
        row['Image']='reviewed';self.assertEqual(n['settled_game']([row],built)['image'],'reviewed')
        self.assertIsNone(n['settled_game']([oneoff],built))

    def module_recovery_fixture(self):
        old={'/opt/royal-game-modules/mortal-kombat/active.json':'a'*64,'/opt/royal-game-modules/other/old.js':'b'*64}
        relative='mortal-kombat/versions/1.0.0-new/manifest.json'
        delta={relative:'c'*64,'mortal-kombat/versions/1.0.0-new/entry.js':'d'*64}
        value={'format':1,'gameId':'mortal-kombat','manifest':'/game-modules/'+relative,'sha256':'c'*64}
        active=hashlib.sha256((json.dumps(value,indent=2)+'\n').encode()).hexdigest()
        n=functions(['require','owned_module_state','settings'],OLD={'moduleFiles':old},M={'moduleDelta':delta,'modulePackages':[{'gameId':'mortal-kombat','version':'1.0.0-new'}]})
        added={'/opt/royal-game-modules/'+name:digest for name,digest in delta.items()}
        return n,{'moduleFiles':copy.deepcopy(old)},added,active
    def test_normal_baseline_still_rejects_own_module_change(self):
        n,state,added,_=self.module_recovery_fixture()
        extras={'configHashes':{},'moduleHostContract':'host','container':{'mounts':[],'host':{},'runtimeHash':'runtime','composeFiles':[]},'services':{},'realMoneyFlags':{}}
        n['OLD'].update(copy.deepcopy(extras));state.update(copy.deepcopy(extras));state['moduleFiles'].update(added)
        with self.assertRaises(RuntimeError):n['settings'](state)
    def test_recovery_settings_allow_only_the_reviewed_own_module(self):
        n,state,added,active=self.module_recovery_fixture()
        extras={'configHashes':{},'moduleHostContract':'host','container':{'mounts':[],'host':{},'runtimeHash':'runtime','composeFiles':[]},'services':{},'realMoneyFlags':{}}
        n['OLD'].update(copy.deepcopy(extras));state.update(copy.deepcopy(extras));state['moduleFiles'].update(added);state['moduleFiles']['/opt/royal-game-modules/mortal-kombat/active.json']=active
        n['settings'](state,recovery=True)
    def test_recovery_accepts_unchanged_modules(self):
        n,state,_,_=self.module_recovery_fixture();n['owned_module_state'](state)
    def test_retry_accepts_own_immutable_version_with_old_pointer(self):
        n,state,added,_=self.module_recovery_fixture();state['moduleFiles'].update(added);n['owned_module_state'](state)
    def test_recovery_preserves_complete_reviewed_compatible_module(self):
        n,state,added,active=self.module_recovery_fixture();state['moduleFiles'].update(added);state['moduleFiles']['/opt/royal-game-modules/mortal-kombat/active.json']=active
        n['owned_module_state'](state)
    def test_recovery_rejects_other_module_addition(self):
        n,state,_,_=self.module_recovery_fixture();state['moduleFiles']['/opt/royal-game-modules/other/new.js']='e'*64
        with self.assertRaises(RuntimeError):n['owned_module_state'](state)
    def test_recovery_rejects_tampered_own_module(self):
        n,state,added,_=self.module_recovery_fixture();state['moduleFiles'].update(added);state['moduleFiles'][next(iter(added))]='e'*64
        with self.assertRaises(RuntimeError):n['owned_module_state'](state)
    def test_recovery_rejects_later_active_pointer(self):
        n,state,_,_=self.module_recovery_fixture();state['moduleFiles']['/opt/royal-game-modules/mortal-kombat/active.json']='e'*64
        with self.assertRaises(RuntimeError):n['owned_module_state'](state)
    def test_recovery_rejects_incomplete_active_version(self):
        n,state,_,active=self.module_recovery_fixture();state['moduleFiles']['/opt/royal-game-modules/mortal-kombat/active.json']=active
        with self.assertRaises(RuntimeError):n['owned_module_state'](state)
    def test_recovery_rejects_deleted_prior_module(self):
        n,state,_,_=self.module_recovery_fixture();del state['moduleFiles']['/opt/royal-game-modules/other/old.js']
        with self.assertRaises(RuntimeError):n['owned_module_state'](state)

    def baseline_fixture(self):
        old={'container':{'image':'old','health':'healthy'},'source':{'server.ts':'a'},'program':{'file':'b'},'preparedProgram':{'file':'b'},'preparedImage':'old'}
        current=copy.deepcopy(old)
        n=functions(['require','baseline','sources'],OLD=old,BASE=old['source'],snapshot=lambda:current,settings=lambda value:None)
        return n,current
    def test_running_image_change_blocks_publication(self):
        n,current=self.baseline_fixture();current['container']['image']='later'
        with self.assertRaises(RuntimeError):n['baseline']()
    def test_source_change_blocks_publication(self):
        n,current=self.baseline_fixture();current['source']['server.ts']='later'
        with self.assertRaises(RuntimeError):n['baseline']()
    def test_prepared_image_change_blocks_publication(self):
        n,current=self.baseline_fixture();current['preparedImage']='later'
        with self.assertRaises(RuntimeError):n['baseline']()
    def test_runtime_change_blocks_publication(self):
        n,current=self.baseline_fixture();current['program']['file']='later'
        with self.assertRaises(RuntimeError):n['baseline']()
    def test_unhealthy_baseline_blocks_publication(self):
        n,current=self.baseline_fixture();current['container']['health']='unhealthy';n['OLD']['container']['health']='unhealthy'
        with self.assertRaises(RuntimeError):n['baseline']()
    def test_other_service_change_is_protected(self):
        old={'configHashes':{},'moduleFiles':{},'moduleHostContract':'contract','container':{'mounts':[],'host':{},'runtimeHash':'runtime','composeFiles':[]},
            'services':{'/royal-game-1':{'image':'game'},'/payments':{'image':'old'}},'realMoneyFlags':{'enabled':False}}
        n=functions(['require','settings'],OLD=old);current=copy.deepcopy(old);current['services']['/payments']['image']='later'
        with self.assertRaises(RuntimeError):n['settings'](current)
    def test_mount_and_module_changes_are_protected(self):
        old={'configHashes':{},'moduleFiles':{},'moduleHostContract':'contract','container':{'mounts':[],'host':{},'runtimeHash':'runtime','composeFiles':[]},
            'services':{},'realMoneyFlags':{}}
        n=functions(['require','settings'],OLD=old)
        for key in ['moduleFiles','configHashes','moduleHostContract']:
            current=copy.deepcopy(old);current[key]='later'
            with self.subTest(key=key),self.assertRaises(RuntimeError):n['settings'](current)
        current=copy.deepcopy(old);current['container']['mounts']=['later']
        with self.assertRaises(RuntimeError):n['settings'](current)


if __name__ == '__main__': unittest.main()
