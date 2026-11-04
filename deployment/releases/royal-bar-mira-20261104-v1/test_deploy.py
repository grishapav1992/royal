import importlib.util, sys, types, unittest
from pathlib import Path
sys.dont_write_bytecode = True
if sys.platform == 'win32': sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec=importlib.util.spec_from_file_location('royal_bar_deploy',Path(__file__).with_name('deploy.py'))
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)

class MiraScopeTest(unittest.TestCase):
    def fixture(self):
        changes={name:'mira-'+name for name in deploy.SOURCES}
        before={'source':{'src/shared/arcadeCatalog.ts':'catalogue','server/demoWallet.ts':'wallet','src/game/SecurityGuard.ts':'guard'},'sourceLF':{}}
        host={'inputs':{**{n:changes[n] for n in deploy.HOST_REQUIRED},**before['source']}}
        backend={'inputs':{**{n:changes[n] for n in deploy.BACKEND_REQUIRED},**before['source'],**deploy.PRESERVED_BACKEND_INPUTS}}
        return changes,{'index.js':'main-backend'},host,backend,before
    def test_reviewed_source_delta_is_allowed(self):deploy.validate_scope(*self.fixture())
    def test_other_backend_programs_are_rejected(self):
        args=list(self.fixture());args[1]['payments.js']='changed'
        with self.assertRaises(RuntimeError):deploy.validate_scope(*args)
    def test_missing_sources_are_rejected(self):
        args=list(self.fixture());args[0].pop('server/bartender.ts')
        with self.assertRaises(RuntimeError):deploy.validate_scope(*args)
    def test_unbound_character_source_is_rejected(self):
        args=list(self.fixture());args[2]['inputs'].pop('src/game/miraCharacterArt.ts')
        with self.assertRaises(RuntimeError):deploy.validate_scope(*args)
    def test_other_chat_artwork_catalogue_and_wallet_are_preserved(self):
        for index in [2,3]:
            for name in ['src/shared/arcadeCatalog.ts','server/demoWallet.ts','src/game/SecurityGuard.ts']:
                args=list(self.fixture());args[index]['inputs'][name]='changed'
                with self.assertRaises(RuntimeError):deploy.validate_scope(*args)
    def test_backend_dictionary_pin_is_required(self):
        args=list(self.fixture());args[3]['inputs']['src/i18n/en.ts']='different'
        with self.assertRaises(RuntimeError):deploy.validate_scope(*args)

if __name__=='__main__':unittest.main()
