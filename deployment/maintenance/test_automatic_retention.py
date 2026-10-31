import hashlib
import importlib.util
import io
import json
import os
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
            with patch.object(cleanup, 'RELEASES', root), patch.object(cleanup, 'referenced_images', return_value=set()), patch.object(cleanup, 'native_retention', return_value=helper):
                rows = cleanup.image_candidates(set())
            self.assertEqual([r['id'] for r in rows], [game])

    def test_low_space_after_cleanup_is_reported_as_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan = {'currentImage':'active','rollbackImage':'old','entries':[],'images':[], 'preservedFinancialFiles':[], 'retainedHistoryReasons':{}}
            applied = {'removedEntries':0,'removedImageTags':0,'dockerRetainedImages':[], 'freeAfter':1,'containersUnchanged':True,'healthOk':True}
            with patch.object(cleanup,'LIVE',root), patch.object(cleanup,'RELEASES',root), patch.object(cleanup,'MODULE_STATE',root), patch.object(cleanup,'healthy',return_value={'Image':'active','Config':{'Labels':{}}}), patch.object(automatic,'select_release',return_value='current'), patch.object(cleanup,'prepare_plan',return_value=plan), patch.object(cleanup,'apply',return_value=applied), patch.object(automatic.os,'geteuid',return_value=0):
                code, result = automatic.execute(root/'runs',root/'last.json')
            self.assertEqual(code,1);self.assertEqual(result['status'],'error')
            self.assertIn('five GiB',result['reason'])


if __name__ == '__main__': unittest.main()
