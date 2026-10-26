import ast
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
    namespace = dict(Path=Path, PurePosixPath=PurePosixPath, hashlib=hashlib, json=json, re=re, tarfile=tarfile, **values)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            exec(compile(ast.Module(body=[node],type_ignores=[]),'deploy.py','exec'),namespace)
    return namespace


class SecurityRelease(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)/'mk-security-20261026-v1'; self.root.mkdir()
        self.n = functions(['require','sha','inventory','safe_name','lock_transition','payload','expected_program','verify_tar','bounded_archive'],
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
        write('server-delta/index.js','new backend'); (self.root/'dist-delta').mkdir()
        for package,version in [('body-parser','2.4.0'),('qs','6.16.1')]: write('dependency-delta/'+package+'/package.json',json.dumps({'version':version}))
        write('dependency-delta/.package-lock.json',json.dumps(new))
        helpers={name:write(name,'reviewed '+name) for name in ['deploy.py','snapshot.py','runtime-inventory.cjs','quiesce.cjs','verify-runtime.cjs','modules.py']}
        source={name:'a'*64 for name in ['server/combatGame.ts','server/combatRoom.ts','server/combatGuard.ts','server/commonCombatWallet.ts',
            'server/pvp/virtual-wallet.ts','server/finance/combat-escrow.ts','server/finance/pvp-money.ts','src/shared/combat.ts','src/shared/combatEscrow.ts','src/shared/pvp.ts']}
        before={'source':source,'sourceLF':{'package-lock.json':old_hash},'dependencyLock':old,
            'program':{'node_modules/body-parser/package.json':'b'*64,'node_modules/qs/package.json':'c'*64,'node_modules/pg/index.js':'d'*64},
            'moduleHost':{'games':{'mortal-kombat':{'apiVersion':1,'rulesVersion':2,'progressVersion':1}}}}
        manifest={'release':self.root.name,'sourceCommit':'e'*40,'helpers':helpers,'before':before,
            'changed':self.n['inventory'](self.root/'source'),'delta':{},'serverDelta':self.n['inventory'](self.root/'server-delta'),
            'runtimePackages':{'package-lock.json':lock_hash},'dependencyFiles':self.n['inventory'](self.root/'dependency-delta')}
        (self.root/'modules').mkdir();manifest.update(moduleDelta={},modulePackages=[{'gameId':'mortal-kombat'}])
        self.n.update(M=manifest,OLD=before,BASE=source,CHANGES=manifest['changed'],DELTA={},SERVER_DELTA=manifest['serverDelta'])

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
            rollback=lambda:calls.append('rollback'),atomic=lambda *args:calls.append('source'))
        with self.assertRaisesRegex(RuntimeError,'busy'):n['publish']()
        self.assertEqual(calls,[])

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
