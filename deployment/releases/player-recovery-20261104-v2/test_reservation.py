import importlib.util, sys, types, unittest
from pathlib import Path
sys.dont_write_bytecode = True
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec = importlib.util.spec_from_file_location('player_recovery_reservation', Path(__file__).with_name('reservation.py'))
reservation = importlib.util.module_from_spec(spec); spec.loader.exec_module(reservation)

class ReservationBindingTest(unittest.TestCase):
    def fixture(self):
        before = {'sourceCommit':'existing','program':{'index':'reviewed'}}
        manifest = {'before':before,'sourceCommit':'prepared','helperSha256':'installer'}
        intent = {'sourceCommit':'prepared','installerSha256':'installer'}
        return manifest,before,intent,'installer'
    def test_exact_reserved_baseline_and_installer_are_accepted(self):
        reservation.validate_ready(*self.fixture())
    def test_changed_production_program_is_rejected(self):
        manifest,before,intent,digest=self.fixture()
        before={'sourceCommit':'existing','program':{'index':'another'}}
        with self.assertRaises(RuntimeError): reservation.validate_ready(manifest,before,intent,digest)
    def test_another_application_revision_is_rejected(self):
        manifest,before,intent,digest=self.fixture();intent['sourceCommit']='another'
        with self.assertRaises(RuntimeError): reservation.validate_ready(manifest,before,intent,digest)
    def test_modified_installer_is_rejected(self):
        manifest,before,intent,digest=self.fixture()
        with self.assertRaises(RuntimeError): reservation.validate_ready(manifest,before,intent,'changed')

if __name__ == '__main__': unittest.main()
