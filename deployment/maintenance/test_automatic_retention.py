import hashlib
import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('automatic', Path(__file__).with_name('automatic-retention.py'))
automatic = importlib.util.module_from_spec(spec); spec.loader.exec_module(automatic)
cleanup = automatic.cleanup


class AutomaticRetentionTest(unittest.TestCase):
    def release(self, root, name, source='source', image='active', complete=True):
        path = root / name; path.mkdir()
        for file, value in {
            'install-manifest.json': {'release': name, 'sourceCommit': source, 'before': {'source': {'a': 'hash'}}},
            'build-result.json': {'sourceCommit': source, 'image': image, 'program': {'a': 'hash'}},
            'published.json': {'published': complete, 'sourceCommit': source, 'runningImage': image},
        }.items(): (path / file).write_text(json.dumps(value))
        return path

    def test_current_scoped_release_is_adopted_instead_of_old_policy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.release(root, 'old', image='old'); self.release(root, 'current')
            self.release(root, 'client-only', source='different')
            self.assertEqual(automatic.select_release('active', 'source', root), 'current')

    def test_missing_ambiguous_and_unpublished_proofs_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.release(root, 'not-published', complete=False)
            with self.assertRaises(RuntimeError): automatic.select_release('active', 'source', root)
            self.release(root, 'current'); self.release(root, 'ambiguous')
            with self.assertRaises(RuntimeError): automatic.select_release('active', 'source', root)

    def test_scoped_rollback_is_complete_only_when_every_changed_old_source_matches(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'source.tgz'
            before = {'a.ts': hashlib.sha256(b'old').hexdigest(), 'b.ts': hashlib.sha256(b'keep').hexdigest()}
            def archive(names):
                with tarfile.open(path, 'w:gz') as stream:
                    for name, value in names.items():
                        info = tarfile.TarInfo(name); info.size = len(value); stream.addfile(info, io.BytesIO(value))
            archive({'a.ts': b'old'})
            self.assertEqual(cleanup.rollback_source_inventory(path, before, {'a.ts': 'new'}), {'a.ts': before['a.ts']})
            for invalid in [{}, {'a.ts': b'wrong'}, {'../a.ts': b'old'}]:
                archive(invalid)
                with self.assertRaises(RuntimeError): cleanup.rollback_source_inventory(path, before, {'a.ts': 'new'})

    def test_program_history_can_be_removed_while_database_backup_stays(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); backup = root / 'old'; backup.mkdir()
            source = backup / 'source.tgz'; source.write_bytes(b'program')
            database = backup / 'game-wallet.dump'; database.write_bytes(b'financial recovery')
            for p in [root, backup, source, database]: os.utime(p, (time.time()-7200,)*2)
            rows = cleanup.deletion_candidates([], (root,), [database])
            self.assertEqual([r['path'] for r in rows], [str(source)])
            cleanup.remove_entry(rows[0], [database], (root,))
            self.assertEqual(database.read_bytes(), b'financial recovery')

    def test_busy_lock_has_nonzero_retry_status_and_persistent_result(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(cleanup, 'LIVE', root), patch.object(cleanup, 'RELEASES', root), patch.object(cleanup, 'MODULE_STATE', root), patch.object(automatic.fcntl, 'flock', side_effect=BlockingIOError), patch.object(automatic.os, 'geteuid', return_value=0):
                code, result = automatic.execute(root/'runs', root/'last.json')
            self.assertEqual(code, 75); self.assertEqual(result['status'], 'retry')
            self.assertEqual(json.loads((root/'last.json').read_text())['status'], 'retry')

    def test_invalid_proof_is_an_error_instead_of_a_successful_skip(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(cleanup, 'LIVE', root), patch.object(cleanup, 'RELEASES', root), patch.object(cleanup, 'MODULE_STATE', root), patch.object(cleanup, 'healthy', side_effect=RuntimeError('Missing proof')), patch.object(automatic.os, 'geteuid', return_value=0):
                code, result = automatic.execute(root/'runs', root/'last.json')
            self.assertEqual(code, 1); self.assertEqual(result['reason'], 'Missing proof')

    def test_audit_retention_is_bounded_and_preserves_unknown_folders(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for i in range(28):
                p = root / ('run-' + format(i, '032x')); p.mkdir(); (p/'summary.json').write_text('{}'); (p/'plan.json').write_text('{}')
            foreign = root/'another-task'; foreign.mkdir(); (foreign/'keep').write_text('keep')
            automatic.rotate_audits(root, None)
            self.assertEqual(len(list(root.glob('run-*'))), 2)
            self.assertEqual(len(list((root/'history').glob('*.json'))), 24)
            self.assertTrue((foreign/'keep').exists())

    def test_image_candidates_are_exact_release_ids_and_exclude_other_services(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); release = root/'old'; release.mkdir()
            game, other = 'sha256:'+'a'*64, 'sha256:'+'b'*64
            (release/'build-result.json').write_text(json.dumps({'image': game, 'before': {'image': other}}))
            helper = unittest.mock.Mock()
            helper.image_row.side_effect = lambda identity: {'id': identity, 'tags': ['royal-game:old' if identity==game else 'royal-payments:old'], 'created': '2026-10-01'}
            with patch.object(cleanup, 'RELEASES', root), patch.object(cleanup,'IMAGE_LEDGER',root/'known.json'), patch.object(cleanup, 'referenced_images', return_value=set()), patch.object(cleanup, 'native_retention', return_value=helper):
                rows = cleanup.image_candidates(set())
                (release/'build-result.json').unlink()
                resumed = cleanup.image_candidates(set())
            self.assertEqual([r['id'] for r in rows], [game])
            self.assertEqual([r['id'] for r in resumed], [game])

    def test_low_space_after_cleanup_is_reported_as_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan = {'currentImage':'active','rollbackImage':'old','entries':[],'images':[], 'preservedFinancialFiles':[], 'retainedHistoryReasons':{}}
            applied = {'removedEntries':0,'removedImageTags':0,'dockerRetainedImages':[], 'freeAfter':1,'containersUnchanged':True,'healthOk':True}
            with patch.object(cleanup,'LIVE',root), patch.object(cleanup,'RELEASES',root), patch.object(cleanup,'MODULE_STATE',root), patch.object(cleanup,'healthy',return_value={'Image':'active','Config':{'Labels':{}}}), patch.object(automatic,'select_release',return_value='current'), patch.object(cleanup,'prepare_plan',return_value=plan), patch.object(cleanup,'apply',return_value=applied), patch.object(automatic.os,'geteuid',return_value=0):
                code, result = automatic.execute(root/'runs',root/'last.json')
            self.assertEqual(code,1);self.assertEqual(result['status'],'error')
            self.assertIn('five GiB',result['reason'])

    def test_oci_metadata_is_hash_verified_without_size_inspection(self):
        runtime=cleanup.native_retention()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            def blob(value):
                raw=json.dumps(value).encode();digest=hashlib.sha256(raw).hexdigest();(root/digest).write_bytes(raw);return 'sha256:'+digest
            config=blob({'created':'2026-10-31','config':{'Labels':{'source':'verified'}}})
            image=blob({'schemaVersion':2,'config':{'digest':config},'layers':[]})
            with patch.object(runtime,'CONTENT',root),patch.object(runtime,'run',return_value='docker.io/library/royal-game:latest\n') as run:
                metadata=runtime.image_metadata(image)
                self.assertEqual(metadata['Id'],image);self.assertEqual(metadata['RepoTags'],['royal-game:latest'])
                self.assertNotIn('docker',run.call_args.args[0])
                (root/config.split(':')[1]).write_text('tampered')
                with self.assertRaisesRegex(RuntimeError,'checksum'):runtime.image_metadata(image)

    def test_hash_verification_container_has_no_network_or_volume_and_is_removed(self):
        runtime=cleanup.native_retention();calls=[];owner=[];identity='a'*64
        def engine(method,path,body=None,timeout=180):
            calls.append((method,path,body))
            if path.startswith('/containers/create'):
                owner.append(body['Labels']['royal.retention.verify']);return json.dumps({'Id':identity}).encode()
            if '/wait?' in path:return b'{"StatusCode":0}'
            if '/logs?' in path:
                raw=b'{"file":"hash"}';return b'\x01\0\0\0'+len(raw).to_bytes(4,'big')+raw
            if path.endswith('/json'):return json.dumps({'Config':{'Labels':{'royal.retention.verify':owner[0]}},'State':{'Running':False}}).encode()
            return b''
        with patch.object(runtime,'image_metadata',return_value={'verified':True}),patch.object(runtime,'engine',side_effect=engine):
            self.assertEqual(runtime.verify_program('sha256:'+'b'*64,'hash-only'),{'file':'hash'})
        host=calls[0][2]['HostConfig'];self.assertTrue(host['ReadonlyRootfs']);self.assertEqual(host['NetworkMode'],'none')
        self.assertNotIn('Binds',host);self.assertEqual(calls[-1][:2],('DELETE','/containers/'+identity))

    def test_independent_game_source_requires_the_verified_current_pointer(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);live=root/'live';releases=root/'releases';modules=root/'modules'
            folder=releases/'game-update';folder.mkdir(parents=True);game=live/'games'/'example';game.mkdir(parents=True)
            (game/'package.json').write_text(json.dumps({'gameId':'studio-example'}))
            active=modules/'studio-example'/'active.json';active.parent.mkdir(parents=True)
            active.write_text(json.dumps({'manifest':'/game-modules/studio-example/versions/1.0.1/manifest.json'}))
            source='a'*40;name='games/example/view.ts';digest='b'*64
            operator={'sourceCommit':source,'source':{name:digest},'pointerSha256':cleanup.sha(active)}
            (folder/'operator.json').write_text(json.dumps(operator))
            (folder/'published.json').write_text(json.dumps({'published':True,'sourceCommit':source,'module':{'verified':True,'gameId':'studio-example','version':'1.0.1'}}))
            (folder/'release-github.json').write_text(json.dumps({'sourceCommit':source,'remoteMain':source}))
            with patch.object(cleanup,'LIVE',live),patch.object(cleanup,'RELEASES',releases),patch.object(cleanup,'MODULES',modules):
                self.assertEqual(len(cleanup.module_source_proof(name,digest)),3)
                self.assertIsNone(cleanup.module_source_proof('server/index.ts',digest))
                active.write_text('{}');self.assertIsNone(cleanup.module_source_proof(name,digest))

    def test_only_hash_attested_program_archives_are_retired(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.tgz';path.write_bytes(b'previously verified program archive')
            proof={'sourceBackupSha256':cleanup.sha(path)}
            self.assertTrue(cleanup.verified_program_archive(path,[proof]))
            path.write_bytes(b'changed after publication');self.assertFalse(cleanup.verified_program_archive(path,[proof]))
            financial=Path(temp)/'wallet.tgz';financial.write_bytes(b'financial archive')
            self.assertFalse(cleanup.verified_program_archive(financial,[{'sourceBackupSha256':cleanup.sha(financial)}]))

    def test_old_failed_build_expires_only_without_process_or_image_reference(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp);(path/'build-result.json').write_text('{}');metadata=[{'image':'candidate'}]
            self.assertTrue(cleanup.pending_is_active(path,metadata,set(),set(),100))
            self.assertTrue(cleanup.pending_is_active(path,metadata,{str(path)},set(),90000))
            self.assertTrue(cleanup.pending_is_active(path,metadata,set(),{'candidate'},90000))
            self.assertFalse(cleanup.pending_is_active(path,metadata,set(),set(),90000))

    def test_host_release_proof_can_omit_redundant_build_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=self.release(root,'scoped')
            built=json.loads((path/'build-result.json').read_text());built.pop('sourceCommit');(path/'build-result.json').write_text(json.dumps(built))
            self.assertEqual(automatic.select_release('active','source',root),'scoped')

    def test_periodic_exit_retries_the_complete_container_snapshot(self):
        runtime=cleanup.native_retention();stable='a'*64;periodic='b'*64
        row={'Id':stable,'Name':'/royal-game-1'}
        missing=subprocess.CalledProcessError(1,['docker','inspect'],stderr='Error: No such object: '+periodic)
        outputs=[stable+' royal-game-1\n'+periodic+' royal-nile-reconcile-once',missing,stable+' royal-game-1',json.dumps([row])]
        with patch.object(runtime,'run',side_effect=outputs):
            self.assertEqual(runtime.container_inspections(),[row])
        with patch.object(runtime,'run',side_effect=[stable+' royal-game-1',subprocess.CalledProcessError(1,[],stderr='Error: No such object: '+stable)]):
            with self.assertRaisesRegex(RuntimeError,'unknown container'):runtime.container_inspections()

    def test_persistent_service_guard_uses_the_retrying_snapshot(self):
        helper=unittest.mock.Mock()
        helper.container_inspections.return_value=[
            {'Name':'/royal-game-1','State':{'Status':'running'},'Config':{'Labels':{}},'HostConfig':{'RestartPolicy':{'Name':'always'}}},
            {'Name':'/royal-nile-reconcile-once','State':{'Status':'running'}},
            {'Name':'/old-stopped','State':{'Status':'exited'}}]
        with patch.object(cleanup,'native_retention',return_value=helper),patch.object(cleanup,'service_identity',return_value={'stable':True}):
            self.assertEqual(cleanup.persistent_services(),{'/royal-game-1':{'stable':True}})


if __name__ == '__main__': unittest.main()
