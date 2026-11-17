"""Only an absent custom DNS list may change representation during completion."""
import copy
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1]/'releases/velvet-dressing-room-20261117-v1/complete-publication.py'
spec = importlib.util.spec_from_file_location('velvet_completion',path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompletionTest(unittest.TestCase):
    def setUp(self):
        self.before = dict(source={'code':'old'},configHashes={'compose':'same'},moduleFiles={'active':'same'},
                           moduleHostContract='same',moduleHost={'api':1},protectedPrograms={'wallet':'same'},
                           realMoneyFlags=None,services={'/royal-game-1':{'id':'old'},'/db':{'id':'same'}},
                           serviceProfiles={'royal-game-1':{'profileSha256':'canonical'},'db':{'id':'same'}},
                           container={'host':{'Dns':[],'Memory':0},'mounts':['data'],'runtimeHash':'same','composeFiles':'same'})
        self.current = copy.deepcopy(self.before)
        self.current.update(source={'code':'new'},program={'bundle':'new'},preparedProgram={'bundle':'new'},preparedImage='candidate')
        self.current['container'].update(health='healthy',image='candidate')
        self.current['container']['host']['Dns']=None
        self.current['services']['/royal-game-1']={'id':'new'}
        self.current['serviceProfiles']['royal-game-1']={'profileSha256':'raw-null'}
        self.built={'image':'candidate','program':{'bundle':'new'}}

    def validate(self, fingerprint='canonical'):
        module.validate_state(self.before,self.current,self.built,{'code':'new'},fingerprint)

    def test_empty_dns_is_equivalent_without_rewriting_raw_evidence(self):
        self.validate()
        self.assertIsNone(self.current['container']['host']['Dns'])
        self.assertEqual(self.current['serviceProfiles']['royal-game-1']['profileSha256'],'raw-null')

    def test_unchanged_empty_dns_is_valid(self):
        self.current['container']['host']['Dns']=[]
        self.validate()

    def test_custom_dns_cannot_be_hidden(self):
        self.current['container']['host']['Dns']=['1.1.1.1']
        with self.assertRaisesRegex(RuntimeError,'Dns'): self.validate()

    def test_other_host_changes_cannot_be_hidden(self):
        self.current['container']['host']['Memory']=1024
        with self.assertRaisesRegex(RuntimeError,'Memory'): self.validate()

    def test_runtime_fingerprint_cannot_be_replaced(self):
        with self.assertRaisesRegex(RuntimeError,'profile'): self.validate('different')

    def test_program_and_source_changes_are_rejected(self):
        for field in ['source','program','preparedProgram']:
            with self.subTest(field=field):
                original=self.current[field]
                self.current[field]={'unexpected':'change'}
                with self.assertRaises(RuntimeError): self.validate()
                self.current[field]=original

    def test_service_and_module_changes_are_rejected(self):
        for field in ['services','serviceProfiles','moduleFiles','moduleHost','configHashes','protectedPrograms']:
            with self.subTest(field=field):
                original=self.current[field]
                self.current[field]={}
                with self.assertRaises(RuntimeError): self.validate()
                self.current[field]=original


if __name__ == '__main__':
    unittest.main()
