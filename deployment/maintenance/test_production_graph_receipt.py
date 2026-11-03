import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('graph_receipt', Path(__file__).with_name('production-graph-receipt.py'))
graph = importlib.util.module_from_spec(spec)
spec.loader.exec_module(graph)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    return graph.sha_file(path)


class Fixture:
    def __init__(self, root, projections=True, module=True):
        self.root = root
        self.release = root / 'releases' / 'current'
        self.live = root / 'live'
        self.modules = root / 'modules'
        self.state = root / 'module-state'
        self.commit = 'a' * 40
        self.host = b'export const value = "host";\n'
        self.backend = b'export const value = "backend";\n'
        self.source = {'src/shared/value.ts': self.host, 'server/index.ts': b'import "../src/shared/value";\n',
                       'games/example/package.json': json.dumps({'gameId': 'example'}).encode(),
                       'games/example/main.ts': b'export const game = true;\n'}
        for name, raw in self.source.items():
            file = self.live / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(raw)
        self.inventory = {name: sha(raw) for name, raw in self.source.items()}
        self.module_hash = self.module('1.0.0') if module else None
        self.host_contract = write(self.state / 'host.json', {'contract': 1})
        self.github = {'sourceCommit': self.commit, 'remoteMain': 'b' * 40}
        receipt_sha = write(self.release / 'release-github.json', self.github)
        self.metadata = {'sourceCommit': self.commit, 'files': {}}
        if projections:
            self.metadata.update({'hostProjection': self.projection({'src/shared/value.ts': self.host}),
                                  'backendProjection': self.projection({'src/shared/value.ts': self.backend})})
            if module:
                report = self.projection({'games/example/main.ts': self.source['games/example/main.ts']})
                report['modules'] = {'example': {'version': '1.0.0', 'manifestSha256': self.module_hash,
                                               'sourceFiles': report['inputs']}}
                self.metadata['build'] = {'moduleProjection': report}
                self.metadata['files']['module-dist/example/versions/1.0.0/manifest.json'] = self.module_hash
        manifest_sha = write(self.release / 'release-manifest.json', self.metadata)
        self.install = {'release': 'current', 'sourceCommit': self.commit,
                        'before': {'source': self.inventory}, 'changed': {},
                        'receiptSha256': receipt_sha, 'releaseManifestSha256': manifest_sha}
        write(self.release / 'install-manifest.json', self.install)
        write(self.release / 'build-result.json', {'image': 'sha256:' + 'c' * 64,
                                                  'program': {'dist/index.html': sha(b'html'), 'dist-server/index.js': sha(b'js')}})
        write(self.release / 'published.json', {'published': True, 'sourceCommit': self.commit,
                                               'runningImage': 'sha256:' + 'c' * 64})
        self.cleanup = SimpleNamespace(RELEASES=root / 'releases', LIVE=self.live, MODULES=self.modules,
                                       MODULE_STATE=self.state, module_source_proof=Mock(return_value=None))
        self.modules.mkdir(exist_ok=True)
        self.current = {'Image':'sha256:'+'c'*64, 'Id':'d'*64,
                        'Config':{'Labels':{'org.opencontainers.image.revision':self.commit}},
                        'State':{'Status':'running','Running':True,'Health':{'Status':'healthy'},'StartedAt':'2026-11-01T00:00:00.000000000Z'}}
        self.cleanup.healthy = Mock(return_value=self.current)
        self.plan = {'release': 'current', 'sourceCommit': self.commit, 'currentImage': 'sha256:' + 'c' * 64,
                     'moduleHostContract': self.host_contract, 'independentModuleProofs': [],
                     'programHashCommand': 'console.log(JSON.stringify({"verified":"reader"}))',
                     'services':{'/royal-game-1':{'id':self.current['Id'],'started':self.current['State']['StartedAt']}}}
        self.refresh()

    def prepare_check(self, receipt):
        current = self.current
        self.cleanup.healthy = Mock(return_value=current)
        self.cleanup.select_current_release = Mock(return_value='current')
        self.cleanup.run = Mock(return_value=json.dumps(receipt['runtimeInventory']))
        self.cleanup.docker_object = Mock(return_value=current)

    def publication_locks(self):
        paths = [self.cleanup.RELEASES/'themed-publish.lock', self.live/'.client-presentation-deploy.lock', self.state/'module.lock']
        for path in paths: path.touch(mode=0o600)
        return paths

    def projection(self, files):
        inputs = {name: sha(raw) for name, raw in files.items()}
        return {'inputs': inputs,
                'origins': {name: {'commit': self.commit, 'path': name, 'baseSha256': final_hash,
                                   'sha256': final_hash, 'patches': []} for name, final_hash in inputs.items()}}

    def module(self, version):
        metadata = {'gameId': 'example', 'version': version, 'files': {'main.js': sha(b'module')}}
        manifest_sha = write(self.modules / 'example' / 'versions' / version / 'manifest.json', metadata)
        (self.modules / 'example' / 'versions' / version / 'main.js').write_bytes(b'module')
        write(self.modules / 'example' / 'active.json', {'manifest': '/game-modules/example/versions/' + version + '/manifest.json',
                                                      'sha256': manifest_sha})
        return manifest_sha

    def refresh(self):
        self.plan['proofs'] = [{'path': str(path), 'sha256': graph.sha_file(path)}
                               for path in sorted(self.release.iterdir()) if path.is_file()]
        self.plan['modules'] = {str(path.relative_to(self.modules)): graph.sha_file(path)
                                for path in self.modules.rglob('*') if path.is_file()}


class ProductionGraphReceiptTest(unittest.TestCase):
    def test_component_projections_preserve_different_bytes_at_same_logical_path(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            result = graph.collect_verified(fixture.plan, fixture.cleanup)
            components = {row['id']: row for row in result['components']}
            self.assertEqual(components['host']['sources'][0]['sha256'], sha(fixture.host))
            self.assertEqual(components['backend']['sources'][0]['sha256'], sha(fixture.backend))
            self.assertEqual(result['sourceInventory']['src/shared/value.ts'], sha(fixture.host))
            self.assertTrue(all(row['coverage'] == 'complete' for row in components.values()))
            self.assertEqual(result['modules'][0]['availability'], 'published-package-only')
            self.assertEqual(result['runtimeFingerprint'], graph.digest(graph.identity_payload(result)))
            self.assertEqual(result['containerIdentity'], {'id':'d'*64,'startedAt':'2026-11-01T00:00:00.000000000Z'})

    def test_missing_origins_stay_partial_and_are_never_inferred_from_source_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp), projections=False)
            result = graph.collect_verified(fixture.plan, fixture.cleanup)
            self.assertEqual(result['coverage']['provenSources'], 0)
            self.assertEqual(result['coverage']['partialComponents'], 3)
            self.assertTrue(all(source['origin'] is None for row in result['components'] for source in row['sources']))
            self.assertEqual(result['components'][0]['sourceSet'], 'verified-live-candidates')

    def test_module_switch_changes_fingerprint_without_changing_host(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            first = graph.collect_verified(fixture.plan, fixture.cleanup)
            fixture.module('1.0.1'); fixture.refresh()
            second = graph.collect_verified(fixture.plan, fixture.cleanup)
            self.assertEqual(first['image'], second['image'])
            self.assertNotEqual(first['runtimeFingerprint'], second['runtimeFingerprint'])
            self.assertEqual(second['components'][-1]['coverage'], 'partial')

    def test_inactive_archived_packages_do_not_change_current_graph_fingerprint(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            first = graph.collect_verified(fixture.plan, fixture.cleanup)
            write(fixture.modules / 'example' / 'versions' / 'retired' / 'manifest.json', {'old': True})
            fixture.refresh()
            second = graph.collect_verified(fixture.plan, fixture.cleanup)
            self.assertEqual(first['runtimeFingerprint'], second['runtimeFingerprint'])
            self.assertNotIn('example/versions/retired/manifest.json', second['moduleInventory'])

    def test_unproven_live_source_and_changed_evidence_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            source = fixture.live / 'server/index.ts'
            source.write_bytes(b'unpublished')
            with self.assertRaisesRegex(RuntimeError, 'no current module publication proof'):
                graph.collect_verified(fixture.plan, fixture.cleanup)
            source.write_bytes(fixture.source['server/index.ts'])
            (fixture.release / 'release-github.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'evidence differs'):
                graph.collect_verified(fixture.plan, fixture.cleanup)

    def test_unbound_projection_manifest_is_not_treated_as_production_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            fixture.install.pop('releaseManifestSha256')
            write(fixture.release / 'install-manifest.json', fixture.install)
            fixture.refresh()
            result = graph.collect_verified(fixture.plan, fixture.cleanup)
            self.assertEqual(result['coverage']['provenSources'], 0)
            self.assertEqual(result['coverage']['partialComponents'], 3)

    def test_patch_contract_is_preserved_and_bad_final_hash_is_rejected(self):
        row = {'commit': 'a' * 40, 'path': 'src/value.ts', 'baseSha256': sha(b'before'),
               'sha256': sha(b'after'), 'patches': [{'from': 'before', 'to': 'after'}]}
        self.assertEqual(graph.origin(row, sha(b'after'))['patches'], row['patches'])
        with self.assertRaisesRegex(RuntimeError, 'final hash differs'):
            graph.origin(row, sha(b'other'))
        for name in ['../outside', '.env', 'server/.env.local', '.ssh/key', 'a\nname', '/etc/file']:
            with self.subTest(name=name), self.assertRaises(RuntimeError): graph.safe_source(name)

    def test_sealed_phaser_runtime_data_paths_are_not_graph_source_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            file = fixture.release/'build-result.json'
            built = json.loads(file.read_text())
            paths = ['dist-server/runtime/node_modules/phaser/src/data/DataManager.js',
                     'dist-server/runtime/node_modules/phaser/src/data/DataManagerPlugin.js',
                     'dist-server/runtime/node_modules/phaser/src/data/events/CHANGE_DATA_EVENT.js']
            for name in paths: built['program'][name] = sha(b'compiled dependency')
            write(file, built); fixture.refresh()
            receipt = graph.collect_verified(fixture.plan, fixture.cleanup)
            for name in paths:
                self.assertEqual(receipt['runtimeInventory'][name], sha(b'compiled dependency'))
                with self.assertRaisesRegex(RuntimeError, 'Sensitive graph source path'): graph.safe_source(name)
            for name in ['../data/file', '/app/data/file', 'data/../file', 'data\\file', 'data\nfile']:
                with self.subTest(name=name), self.assertRaises(RuntimeError): graph.safe_inventory_path(name)

    def test_emit_is_immutable_atomic_and_failed_recollection_preserves_latest(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            store = Path(temp).resolve() / 'brain'
            result = graph.emit_verified(fixture.plan, fixture.cleanup, store)
            first = (store / 'receipts' / 'latest.json').read_bytes()
            with patch.object(graph.time, 'strftime', return_value='2030-01-01T00:00:00Z'):
                second = graph.emit_verified(fixture.plan, fixture.cleanup, store)
            self.assertEqual(result, second)
            self.assertEqual(first, (store / 'receipts' / 'latest.json').read_bytes())
            self.assertEqual(first, Path(result['receipt']).read_bytes())
            (fixture.live / 'server/index.ts').write_bytes(b'unverified')
            with self.assertRaises(RuntimeError): graph.emit_verified(fixture.plan, fixture.cleanup, store)
            self.assertEqual(first, (store / 'receipts' / 'latest.json').read_bytes())

    def test_invalid_active_manifest_and_package_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            (fixture.modules / 'example' / 'versions' / '1.0.0' / 'main.js').write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError, 'Active module package changed'):
                graph.collect_verified(fixture.plan, fixture.cleanup)

    def test_fresh_check_verifies_runtime_bytes_and_does_not_run_retention(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            receipt = graph.collect_verified(fixture.plan, fixture.cleanup)
            fixture.prepare_check(receipt)
            self.assertEqual(graph.verify_live_receipt(receipt, fixture.cleanup), {'runtimeFingerprint': receipt['runtimeFingerprint']})
            fixture.cleanup.run.assert_called_once_with(['docker','exec','royal-game-1','node','-e',fixture.plan['programHashCommand']])
            fixture.cleanup.run.return_value = '{}'
            with self.assertRaisesRegex(RuntimeError, 'Running production program differs'):
                graph.verify_live_receipt(receipt, fixture.cleanup)

    def test_fresh_check_rejects_added_active_pointers_and_package_files(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            receipt = graph.collect_verified(fixture.plan, fixture.cleanup)
            fixture.prepare_check(receipt)
            added = fixture.modules / 'other' / 'active.json'
            write(added, {})
            with self.assertRaisesRegex(RuntimeError, 'active module set changed'):
                graph.verify_live_receipt(receipt, fixture.cleanup)
            added.unlink()
            (fixture.modules / 'example' / 'versions' / '1.0.0' / 'extra.js').write_bytes(b'extra')
            with self.assertRaisesRegex(RuntimeError, 'package inventory changed'):
                graph.verify_live_receipt(receipt, fixture.cleanup)

    def test_fresh_check_rejects_source_receipt_and_container_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            receipt = graph.collect_verified(fixture.plan, fixture.cleanup)
            fixture.prepare_check(receipt)
            source = fixture.live / 'server/index.ts'
            source.write_bytes(b'drift')
            with self.assertRaisesRegex(RuntimeError, 'Production source differs'):
                graph.verify_live_receipt(receipt, fixture.cleanup)
            source.write_bytes(fixture.source['server/index.ts'])
            final = dict(fixture.cleanup.healthy.return_value, Id='replacement-container')
            fixture.cleanup.docker_object.return_value = final
            with self.assertRaisesRegex(RuntimeError, 'Production changed during'):
                graph.verify_live_receipt(receipt, fixture.cleanup)
            receipt['image'] = 'another-image'
            with self.assertRaisesRegex(RuntimeError, 'fingerprint differs'):
                graph.verify_live_receipt(receipt, fixture.cleanup)

    def test_module_publication_during_runtime_reader_does_not_pass_fresh_check(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp))
            receipt = graph.collect_verified(fixture.plan, fixture.cleanup)
            fixture.prepare_check(receipt)
            def read_runtime(command):
                fixture.module('1.0.1')
                return json.dumps(receipt['runtimeInventory'])
            fixture.cleanup.run.side_effect = read_runtime
            with self.assertRaisesRegex(RuntimeError, 'Production module differs'):
                graph.verify_live_receipt(receipt, fixture.cleanup)

    def test_publication_check_is_identity_only_and_holds_all_shared_locks(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Fixture(Path(temp)); receipt = graph.collect_verified(fixture.plan, fixture.cleanup)
            fixture.prepare_check(receipt); fixture.publication_locks(); handles=[]; passes=[]
            (fixture.live/'server/index.ts').write_bytes(b'unsupported in-place edit')
            (fixture.modules/'example/versions/1.0.0/main.js').write_bytes(b'unsupported asset edit')
            original = graph.verify_publication_identities
            def identities(value, cleanup):
                self.assertEqual(len(handles),3)
                for handle in handles: os.fstat(handle)
                passes.append(True); return original(value,cleanup)
            with patch.object(graph.fcntl,'flock',side_effect=lambda handle,flags:handles.append(handle)) as locks, patch.object(graph,'verify_publication_identities',side_effect=identities):
                result = graph.verify_publication_receipt(receipt,fixture.cleanup,owner_uid=os.getuid())
            self.assertEqual(result['checkScope'],'deployment-identity')
            self.assertEqual(result['lastProgramVerificationAt'],receipt['collectedAt'])
            self.assertEqual(result['runtimeFingerprint'],receipt['runtimeFingerprint']);self.assertEqual(len(passes),2)
            self.assertTrue(all(call.args[1] == graph.fcntl.LOCK_SH|graph.fcntl.LOCK_NB for call in locks.call_args_list))
            for handle in handles:
                with self.assertRaises(OSError): os.fstat(handle)
            fixture.cleanup.run.assert_not_called()
            fixture.cleanup.healthy.assert_not_called()
            self.assertEqual(fixture.cleanup.docker_object.call_args_list,[unittest.mock.call('container','royal-game-1')]*2)
            with self.assertRaisesRegex(RuntimeError,'Production source differs'): graph.verify_live_receipt(receipt,fixture.cleanup)

    def test_publication_check_requires_recorded_docker_running_and_health_without_health_api(self):
        for field in ['status','running','health','missing-health']:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                fixture=Fixture(Path(temp));receipt=graph.collect_verified(fixture.plan,fixture.cleanup)
                fixture.prepare_check(receipt);fixture.publication_locks()
                if field=='status':fixture.current['State']['Status']='exited'
                if field=='running':fixture.current['State']['Running']=False
                if field=='health':fixture.current['State']['Health']['Status']='unhealthy'
                if field=='missing-health':fixture.current['State'].pop('Health')
                with self.assertRaisesRegex(RuntimeError,'not running and healthy'):
                    graph.verify_publication_receipt(receipt,fixture.cleanup,owner_uid=os.getuid())
                fixture.cleanup.healthy.assert_not_called();fixture.cleanup.run.assert_not_called()

    def test_publication_check_fails_closed_on_container_and_selected_release_changes(self):
        for field in ['image','source','id','started','release','missing-recorded','missing-fresh']:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                fixture=Fixture(Path(temp));receipt=graph.collect_verified(fixture.plan,fixture.cleanup)
                fixture.prepare_check(receipt);fixture.publication_locks()
                if field=='image':fixture.current['Image']='sha256:'+'e'*64
                if field=='source':fixture.current['Config']['Labels']['org.opencontainers.image.revision']='e'*40
                if field=='id':fixture.current['Id']='e'*64
                if field=='started':fixture.current['State']['StartedAt']='2026-11-02T00:00:00Z'
                if field=='release':fixture.cleanup.select_current_release.return_value='other'
                if field=='missing-recorded':
                    receipt.pop('containerIdentity');receipt['runtimeFingerprint']=graph.digest(graph.identity_payload(receipt))
                if field=='missing-fresh':fixture.current['State'].pop('StartedAt')
                with self.assertRaises(RuntimeError):graph.verify_publication_receipt(receipt,fixture.cleanup,owner_uid=os.getuid())
                fixture.cleanup.run.assert_not_called()

    def test_publication_check_fails_closed_on_pointers_manifests_and_host_contract(self):
        for field in ['pointer','added-pointer','manifest','contract']:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                fixture=Fixture(Path(temp));receipt=graph.collect_verified(fixture.plan,fixture.cleanup)
                fixture.prepare_check(receipt);fixture.publication_locks()
                if field=='pointer':fixture.module('1.0.1')
                if field=='added-pointer':write(fixture.modules/'other/active.json',{})
                if field=='manifest':write(fixture.modules/'example/versions/1.0.0/manifest.json',{'changed':True})
                if field=='contract':write(fixture.state/'host.json',{'changed':True})
                with self.assertRaises(RuntimeError):graph.verify_publication_receipt(receipt,fixture.cleanup,owner_uid=os.getuid())
                fixture.cleanup.run.assert_not_called()

    def test_publication_check_lock_contention_and_missing_lock_never_scan_program(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture=Fixture(Path(temp));receipt=graph.collect_verified(fixture.plan,fixture.cleanup)
            fixture.prepare_check(receipt);paths=fixture.publication_locks();fixture.cleanup.healthy.reset_mock()
            with patch.object(graph.fcntl,'flock',side_effect=BlockingIOError):
                with self.assertRaises(BlockingIOError):graph.verify_publication_receipt(receipt,fixture.cleanup,owner_uid=os.getuid())
            fixture.cleanup.healthy.assert_not_called();fixture.cleanup.run.assert_not_called()
            fixture.cleanup.docker_object.assert_not_called()
            paths[-1].unlink()
            with self.assertRaises(FileNotFoundError):graph.verify_publication_receipt(receipt,fixture.cleanup,owner_uid=os.getuid())
            fixture.cleanup.healthy.assert_not_called();fixture.cleanup.run.assert_not_called()
            fixture.cleanup.docker_object.assert_not_called()

    def test_publication_check_repeats_mutable_identities_before_unlock(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture=Fixture(Path(temp));receipt=graph.collect_verified(fixture.plan,fixture.cleanup)
            fixture.prepare_check(receipt);fixture.publication_locks();original=graph.verify_publication_identities;passes=[]
            def identities(value,cleanup):
                original(value,cleanup);passes.append(True)
                if len(passes)==1:fixture.module('1.0.1')
            with patch.object(graph,'verify_publication_identities',side_effect=identities):
                with self.assertRaisesRegex(RuntimeError,'pointer differs'):graph.verify_publication_receipt(receipt,fixture.cleanup,owner_uid=os.getuid())
            self.assertEqual(len(passes),1)

    def test_collector_and_full_check_require_fresh_recorded_container_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture=Fixture(Path(temp));receipt=graph.collect_verified(fixture.plan,fixture.cleanup)
            fixture.prepare_check(receipt)
            fixture.current['Id']='e'*64
            with self.assertRaisesRegex(RuntimeError,'container differs'):graph.verify_live_receipt(receipt,fixture.cleanup)
            fixture.cleanup.run.assert_not_called()
            with self.assertRaisesRegex(RuntimeError,'maintenance container identity changed'):graph.collect_verified(fixture.plan,fixture.cleanup)


if __name__ == '__main__': unittest.main()
