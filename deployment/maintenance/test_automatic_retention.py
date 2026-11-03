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
            with patch.object(cleanup, 'LIVE', root), patch.object(cleanup, 'RELEASES', root), patch.object(cleanup, 'MODULE_STATE', root), patch.object(automatic.fcntl, 'flock', side_effect=BlockingIOError), patch.object(automatic.os, 'geteuid', return_value=0), patch.object(automatic, 'project_brain_receipt') as graph, patch.object(automatic.subprocess, 'run') as queue:
                code, result = automatic.execute(root/'runs', root/'last.json')
            graph.assert_not_called(); queue.assert_not_called()
            self.assertEqual(code, 75); self.assertEqual(result['status'], 'retry')
            self.assertEqual(json.loads((root/'last.json').read_text())['status'], 'retry')

    def test_invalid_proof_is_an_error_instead_of_a_successful_skip(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(cleanup, 'LIVE', root), patch.object(cleanup, 'RELEASES', root), patch.object(cleanup, 'MODULE_STATE', root), patch.object(cleanup, 'healthy', side_effect=RuntimeError('Missing proof')), patch.object(automatic.os, 'geteuid', return_value=0), patch.object(automatic, 'project_brain_receipt') as graph, patch.object(automatic.subprocess, 'run') as queue:
                code, result = automatic.execute(root/'runs', root/'last.json')
            graph.assert_not_called(); queue.assert_not_called()
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
            with patch.object(cleanup,'LIVE',root), patch.object(cleanup,'RELEASES',root), patch.object(cleanup,'MODULE_STATE',root), patch.object(cleanup,'healthy',return_value={'Image':'active','Config':{'Labels':{}}}), patch.object(automatic,'select_release',return_value='current'), patch.object(cleanup,'prepare_plan',return_value=plan), patch.object(cleanup,'apply',return_value=applied), patch.object(automatic.os,'geteuid',return_value=0), patch.object(automatic,'project_brain_receipt') as graph, patch.object(automatic.subprocess,'run') as queue:
                code, result = automatic.execute(root/'runs',root/'last.json')
            graph.assert_not_called(); queue.assert_not_called()
            self.assertEqual(code,1);self.assertEqual(result['status'],'error')
            self.assertIn('five GiB',result['reason'])

    def completed_with_brain(self, root, emitter, launcher):
        plan = {'currentImage':'active','rollbackImage':'old','entries':[],'images':[],
                'preservedFinancialFiles':[], 'retainedHistoryReasons':{}}
        applied = {'removedEntries':0,'removedImageTags':0,'dockerRetainedImages':[], 'freeAfter':6*1024**3,
                   'containersUnchanged':True,'healthOk':True}
        with patch.object(cleanup,'LIVE',root), patch.object(cleanup,'RELEASES',root), patch.object(cleanup,'MODULE_STATE',root), patch.object(cleanup,'healthy',return_value={'Image':'active','Config':{'Labels':{}}}), patch.object(automatic,'select_release',return_value='current'), patch.object(cleanup,'prepare_plan',return_value=plan), patch.object(cleanup,'apply',return_value=applied), patch.object(automatic.os,'geteuid',return_value=0), patch.object(automatic,'project_brain_receipt',side_effect=emitter), patch.object(automatic.subprocess,'run',side_effect=launcher):
            return automatic.execute(root/'runs',root/'last.json')

    def test_graph_receipt_is_collected_under_lock_and_queued_only_after_unlock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); locks = []; events = []
            def emitter(plan):
                self.assertEqual(len(locks), 3)
                self.assertTrue(all(not lock.closed for lock in locks))
                events.append('receipt')
                return {'status':'pending','runtimeFingerprint':'f'*64,'receipt':'/trusted/receipt.json'}
            def launch(command, **options):
                self.assertTrue(all(lock.closed for lock in locks))
                self.assertEqual(command, ['systemctl','start','--no-block','royal-project-brain-update.service'])
                events.append('queue')
            with patch.object(automatic.fcntl,'flock',side_effect=lambda handle, flags: locks.append(handle)):
                code, result = self.completed_with_brain(root, emitter, launch)
            self.assertEqual(code, 0); self.assertEqual(events, ['receipt','queue'])
            self.assertTrue(result['projectBrain']['queued'])
            self.assertTrue(json.loads((root/'last.json').read_text())['projectBrain']['queued'])

    def test_graph_failure_is_explicit_without_claiming_graph_updated(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); launch = unittest.mock.Mock()
            def invalid(plan): raise RuntimeError('Unbound projection')
            code, result = self.completed_with_brain(root, invalid, launch)
            self.assertEqual(code, 0); self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['projectBrain'], {'status':'error','reason':'Unbound projection','queued':False})
            launch.assert_not_called()

    def test_unconfigured_graph_is_not_queued_and_queue_failure_is_recorded(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); launch = unittest.mock.Mock()
            code, result = self.completed_with_brain(root, lambda plan: {'status':'not_configured'}, launch)
            self.assertEqual(code, 0); self.assertEqual(result['projectBrain']['status'], 'not_configured')
            launch.assert_not_called()
            def failed(*args, **kwargs): raise subprocess.CalledProcessError(1, args[0])
            code, result = self.completed_with_brain(root, lambda plan: {'status':'pending'}, failed)
            self.assertEqual(code, 0); self.assertFalse(result['projectBrain']['queued'])
            self.assertIn('queueError', result['projectBrain'])

    def retry_fixture(self, root):
        runs=root/'runs'; run=runs/('run-'+'a'*32); run.mkdir(parents=True,mode=0o700); runs.chmod(0o700)
        plan={'release':'current','sourceCommit':'a'*40,'currentImage':'active','rollbackImage':'rollback',
              'rollbackImageProof':{'image':'rollback','verified':True},'keep':['current','previous'],'policy':{'verified':True}}
        summary={key:plan[key] for key in ['release','sourceCommit','currentImage','rollbackImage','rollbackImageProof']}
        summary.update({'status':'completed','containersUnchanged':True,'healthOk':True,'verificationPasses':2,
                        'freeAfter':6*1024**3,'projectBrain':{'status':'error','reason':'Sensitive graph source path','queued':False}})
        applied={**summary,'ok':True,'configurationUnchanged':True,'externalModulesUnchanged':True,
                 'databaseRestored':False,'volumesDeleted':False,'retainedHistory':plan['keep']}
        for name,value in [('plan.json',plan),('result.json',applied),('summary.json',summary)]:
            cleanup.write(run/name,value)
        cleanup.write(root/'last.json',summary)
        retention=root/'retention';retention.mkdir();cleanup.write(retention/'policy.json',plan['policy'])
        return runs,run,plan,summary,retention

    def run_brain_retry(self, root, fixture, emitter=None, launcher=None, verifier=None):
        runs,run,plan,summary,retention=fixture
        with patch.object(cleanup,'LIVE',root),patch.object(cleanup,'RELEASES',root),patch.object(cleanup,'MODULE_STATE',root),patch.object(cleanup,'RETENTION',retention),patch.object(cleanup,'healthy',return_value={'Image':'active','Config':{'Labels':{'org.opencontainers.image.revision':'a'*40}}}),patch.object(automatic,'select_release',return_value='current'),patch.object(cleanup,'verify',side_effect=verifier) as verify,patch.object(cleanup,'apply') as apply,patch.object(cleanup,'prepare_plan') as prepare,patch.object(automatic.os,'geteuid',return_value=0),patch.object(automatic,'project_brain_receipt',side_effect=emitter or (lambda plan:{'status':'pending','runtimeFingerprint':'f'*64})),patch.object(automatic.subprocess,'run',side_effect=launcher):
            result=automatic.retry_project_brain(run,runs,root/'last.json',owner_uid=os.getuid())
        apply.assert_not_called();prepare.assert_not_called()
        return result,verify

    def test_completed_run_graph_retry_reverifies_under_locks_and_never_repeats_cleanup(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve(); fixture=self.retry_fixture(root);locks=[];events=[]
            def verify(plan):
                self.assertTrue(all(not lock.closed for lock in locks));events.append('verify')
            def emit(plan):
                self.assertTrue(all(not lock.closed for lock in locks));events.append('receipt')
                return {'status':'pending','runtimeFingerprint':'f'*64}
            def launch(command,**options):
                self.assertTrue(all(lock.closed for lock in locks));events.append('queue')
            with patch.object(automatic.fcntl,'flock',side_effect=lambda handle,flags:locks.append(handle)):
                (code,result),verified=self.run_brain_retry(root,fixture,emit,launch,verify)
            self.assertEqual(code,0);self.assertEqual(events,['verify','receipt','queue'])
            verified.assert_called_once_with(fixture[2]);self.assertEqual(result['status'],'queued')
            saved=cleanup.read(fixture[1]/'summary.json')
            self.assertEqual(saved['status'],'completed');self.assertEqual(saved['projectBrainRetry']['status'],'queued')
            self.assertEqual(saved,cleanup.read(root/'last.json'))

    def test_failed_or_mismatched_completed_proofs_cannot_retry_graph(self):
        for field in ['status','sourceCommit','verificationPasses']:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                root=Path(temp).resolve();fixture=self.retry_fixture(root);summary=fixture[3]
                summary[field]='error' if field=='status' else 'different'
                cleanup.write(fixture[1]/'summary.json',summary)
                with self.assertRaises(RuntimeError):self.run_brain_retry(root,fixture)

    def test_graph_retry_fresh_failure_is_explicit_and_later_result_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();fixture=self.retry_fixture(root)
            later={'status':'retry','reason':'A later run owns this result'};cleanup.write(root/'last.json',later)
            emitter=unittest.mock.Mock();launcher=unittest.mock.Mock()
            (code,result),verified=self.run_brain_retry(root,fixture,emitter,launcher,RuntimeError('Current program changed'))
            self.assertEqual(code,1);self.assertEqual(result['status'],'error')
            self.assertEqual(result['projectBrain']['reason'],'Current program changed')
            emitter.assert_not_called();launcher.assert_not_called();self.assertEqual(cleanup.read(root/'last.json'),later)

    def test_graph_retry_does_not_queue_when_space_falls_below_floor(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();fixture=self.retry_fixture(root)
            emitter=unittest.mock.Mock();launcher=unittest.mock.Mock()
            with patch.object(automatic.shutil,'disk_usage',return_value=unittest.mock.Mock(free=1)):
                (code,result),verified=self.run_brain_retry(root,fixture,emitter,launcher)
            self.assertEqual(code,1);self.assertIn('five GiB',result['reason'])
            verified.assert_called_once();emitter.assert_not_called();launcher.assert_not_called()

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
            delta=Path(temp)/'source-delta.tgz';delta.write_bytes(path.read_bytes())
            self.assertTrue(cleanup.verified_program_archive(delta,[proof]))
            path.write_bytes(b'changed after publication');self.assertFalse(cleanup.verified_program_archive(path,[proof]))
            financial=Path(temp)/'wallet.tgz';financial.write_bytes(b'financial archive')
            self.assertFalse(cleanup.verified_program_archive(financial,[{'sourceBackupSha256':cleanup.sha(financial)}]))

    def test_old_failed_build_expires_only_without_process_or_image_reference(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp);(path/'build-result.json').write_text('{}');metadata=[{'image':'candidate'}]
            self.assertTrue(cleanup.pending_is_active(path,metadata,set(),set(),100))
            self.assertTrue(cleanup.pending_is_active(path,metadata,{str(path)},set(),90000))
            self.assertTrue(cleanup.pending_is_active(path,metadata,set(),{'candidate'},90000))
            os.utime(path/'build-result.json',(time.time()-90001,)*2)
            self.assertFalse(cleanup.pending_is_active(path,metadata,set(),set(),90000))

    def test_unbuilt_preparation_has_the_same_grace_as_a_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp);manifest=path/'install-manifest.json';manifest.write_text('{}')
            self.assertTrue(cleanup.pending_is_active(path,[],set(),set(),3600))
            os.utime(manifest,(time.time()-90001,)*2)
            self.assertFalse(cleanup.pending_is_active(path,[],set(),set(),90000))

    def test_fresh_metadata_protects_a_resumed_old_preparation(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp);(path/'install-manifest.json').write_text('{}')
            self.assertTrue(cleanup.pending_is_active(path,[],set(),set(),90000))
            (path/'published.json').write_text('{}')
            self.assertFalse(cleanup.pending_is_active(path,[],set(),set(),90000))

    def test_process_working_directory_protects_a_relative_deploy_command(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();releases=root/'releases';release=releases/'preparing';release.mkdir(parents=True)
            proc=root/'proc';process=proc/'123';process.mkdir(parents=True)
            (process/'cmdline').write_bytes(b'python3\0deploy.py\0release\0')
            (process/'cwd').symlink_to(release,target_is_directory=True)
            with patch.object(cleanup,'RELEASES',releases):
                self.assertEqual(cleanup.active_release_paths(proc),{str(release)})

    def test_a_receipt_alone_does_not_revive_partially_cleaned_history(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp);(path/'release-github.json').write_text('{}')
            self.assertFalse(cleanup.pending_is_active(path,[],set(),set(),90000))

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

    def test_history_evidence_survives_release_directory_removal(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); releases=root/'releases'; backups=root/'backups'; releases.mkdir();backups.mkdir()
            release=releases/'old'; backup=backups/'old';release.mkdir();backup.mkdir()
            archive=backup/'source.tgz';archive.write_bytes(b'verified program archive')
            financial=backup/'game-wallet.dump';financial.write_bytes(b'player data')
            source='a'*40
            (release/'build-result.json').write_text(json.dumps({'sourceCommit':source,'sourceBackupSha256':cleanup.sha(archive),'program':{'private-irrelevant-map':'not copied'}}))
            (release/'published.json').write_text(json.dumps({'published':True,'sourceCommit':source}))
            allow=root/'commits.json';allow.write_text(json.dumps({'commits':[source]}))
            for p in [release,backup,archive,financial]:os.utime(p,(time.time()-7200,)*2)
            original_candidates=cleanup.deletion_candidates
            with patch.object(cleanup,'RELEASES',releases),patch.object(cleanup,'BACKUPS',backups),patch.object(cleanup,'ROOTS',(releases,backups)),patch.object(cleanup,'PRESERVED_COMMITS',allow),patch.object(cleanup,'HISTORY_LEDGER',root/'history.json'),patch.object(cleanup,'active_release_paths',return_value=set()),patch.object(cleanup,'referenced_images',return_value=set()),patch.object(cleanup,'deletion_candidates',wraps=lambda keep,protected:original_candidates(keep,(releases,backups),protected)):
                first,_,_,_=cleanup.safe_history_candidates([])
                release_row=next(r for r in first if r['path']==str(release))
                cleanup.remove_entry(release_row,[],(releases,backups))
                os.utime(backup,(time.time()-300,)*2)
                fresh,_,_,_=cleanup.safe_history_candidates([])
                self.assertNotIn(str(archive),[r['path'] for r in fresh])
                os.utime(backup,(time.time()-7200,)*2)
                resumed,_,_,_=cleanup.safe_history_candidates([])
            self.assertIn(str(archive),[r['path'] for r in resumed]);self.assertTrue(financial.exists())
            self.assertNotIn('private-irrelevant-map',(root/'history.json').read_text())


if __name__ == '__main__': unittest.main()
