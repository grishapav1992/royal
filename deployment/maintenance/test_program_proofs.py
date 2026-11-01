import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('program_runtime',Path(__file__).with_name('retention-runtime.py'))
runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
spec=importlib.util.spec_from_file_location('program_cleanup',Path(__file__).with_name('cleanup-release-history.py'))
cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)

class ImageProgramProofTest(unittest.TestCase):
    image='sha256:'+'a'*64
    expected={'dist/index.js':'b'*64}

    def test_only_identical_immutable_image_reader_and_inventory_reuse_a_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()/'proofs'
            with patch.object(runtime,'image_metadata',return_value={'Id':self.image}),patch.object(runtime,'verify_program',return_value=self.expected) as verify:
                self.assertFalse(runtime.verify_image_program(self.image,'reader',self.expected,root)['reused'])
                self.assertTrue(runtime.verify_image_program(self.image,'reader',self.expected,root)['reused'])
                self.assertEqual(verify.call_count,1)
                self.assertFalse(runtime.verify_image_program('sha256:'+'c'*64,'reader',self.expected,root)['reused'])
                self.assertFalse(runtime.verify_image_program(self.image,'new-reader',self.expected,root)['reused'])
                changed={'dist/index.js':'d'*64};verify.return_value=changed
                self.assertFalse(runtime.verify_image_program(self.image,'reader',changed,root)['reused'])
                self.assertEqual(verify.call_count,4)

    def test_corruption_forces_full_read_and_failed_read_cannot_become_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()/'proofs'
            with patch.object(runtime,'image_metadata',return_value={'Id':self.image}),patch.object(runtime,'verify_program',return_value=self.expected) as verify:
                runtime.verify_image_program(self.image,'reader',self.expected,root)
                path=runtime.program_proof_path(runtime.program_proof_identity(self.image,'reader',self.expected),root)
                path.write_text('corrupted')
                self.assertFalse(runtime.verify_image_program(self.image,'reader',self.expected,root)['reused'])
                verify.return_value={'dist/index.js':'e'*64}
                with self.assertRaisesRegex(RuntimeError,'bytes differ'):
                    runtime.verify_image_program(self.image,'changed reader',self.expected,root)
                self.assertEqual(len(list(root.glob('*.json'))),1)

    def test_missing_image_and_unsafe_proof_permissions_or_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp).resolve();root=base/'proofs';root.mkdir(mode=0o755)
            with patch.object(runtime,'image_metadata',return_value=None):
                with self.assertRaisesRegex(RuntimeError,'missing'):runtime.verify_image_program(self.image,'reader',self.expected,root)
            with patch.object(runtime,'image_metadata',return_value={'Id':self.image}):
                with self.assertRaisesRegex(RuntimeError,'private'):runtime.verify_image_program(self.image,'reader',self.expected,root)
                root.chmod(0o700);link=base/'link';link.symlink_to(root,target_is_directory=True)
                with self.assertRaisesRegex(RuntimeError,'Unsafe'):runtime.verify_image_program(self.image,'reader',self.expected,link)
                path=runtime.program_proof_path(runtime.program_proof_identity(self.image,'reader',self.expected),root)
                target=base/'keep';target.write_text('keep');path.symlink_to(target)
                with self.assertRaisesRegex(RuntimeError,'symlink'):runtime.verify_image_program(self.image,'reader',self.expected,root)
                self.assertEqual(target.read_text(),'keep')

    def test_verified_candidate_can_seed_the_proof_without_another_container(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()/'proofs'
            with patch.object(runtime,'image_metadata',return_value={'Id':self.image}),patch.object(runtime,'verify_program') as verify:
                runtime.remember_program(self.image,'reader',self.expected,self.expected,root)
                self.assertTrue(runtime.verify_image_program(self.image,'reader',self.expected,root)['reused']);verify.assert_not_called()
            for bad in [{}, {'../outside':'a'*64}, {'file':'invalid'}]:
                with self.assertRaises(RuntimeError):runtime.program_proof_identity(self.image,'reader',bad)

class DestructiveCheckpointTest(unittest.TestCase):
    def test_checks_remain_immediately_before_deletion_and_after_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);retention=root/'retention';retention.mkdir();policy=retention/'policy.json';policy.write_text('{}')
            state=root/'state';state.mkdir();old=root/'old';old.write_text('retired program');events=[]
            plan={'oldPolicySha256':cleanup.sha(policy),'entries':[{'path':str(old)}],'keep':[], 'images':[], 'skipImageCleanup':True,
                  'policy':{'new':True},'release':'current','sourceCommit':'source','currentImage':'current','rollbackImage':'rollback','freeBefore':123}
            def remove(*args):events.append('delete');old.unlink()
            with patch.object(cleanup,'RETENTION',retention),patch.object(cleanup,'LIVE',root),patch.object(cleanup,'ROOTS',(root,)),patch.object(cleanup,'verify',side_effect=lambda value:events.append('verify')),patch.object(cleanup,'validate_selection'),patch.object(cleanup,'remove_entry',side_effect=remove):
                result=cleanup.apply(plan,state)
            self.assertEqual(events,['verify','delete','verify']);self.assertEqual(result['verificationPasses'],2)
            self.assertEqual(json.loads(policy.read_text()),{'new':True})

    def test_failed_predelete_check_leaves_policy_and_history_intact(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);policy=root/'policy.json';policy.write_text('{}');state=root/'state';state.mkdir();old=root/'old';old.write_text('keep')
            plan={'oldPolicySha256':cleanup.sha(policy),'entries':[],'keep':[],'images':[],'skipImageCleanup':True,'policy':{'new':True}}
            with patch.object(cleanup,'RETENTION',root),patch.object(cleanup,'validate_selection'),patch.object(cleanup,'verify',side_effect=RuntimeError('runtime changed')):
                with self.assertRaisesRegex(RuntimeError,'runtime changed'):cleanup.apply(plan,state)
            self.assertEqual(policy.read_text(),'{}');self.assertEqual(old.read_text(),'keep')

if __name__=='__main__':unittest.main()
